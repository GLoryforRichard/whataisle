'use client';

import { publishMapAction } from '@/actions/publish-map';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { FloorMapJson } from '@/db/store.schema';
import { useLocaleRouter } from '@/i18n/navigation';
import { TrashIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Internal mapping tool (requirements §6: "doesn't need to be user-friendly —
 * it's for us"). Click-drag on the 100×100 canvas to draw a shelf rectangle,
 * assign its code (matching the store's aisle signs), then publish. Missing
 * shelf codes are auto-created server-side so pre-map scans link up.
 */

const VIEW = 100;

interface DrawnShelf {
  id: string;
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sides: boolean;
}

interface MappingToolProps {
  storeId: string;
  storeName: string;
  ticketId: string;
  existingCodes: string[];
  initial?: FloorMapJson | null;
}

export function MappingTool({
  storeId,
  storeName,
  ticketId,
  existingCodes,
  initial,
}: MappingToolProps) {
  const t = useTranslations('Manage.mapTool');
  const router = useLocaleRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [shelves, setShelves] = useState<DrawnShelf[]>(() =>
    (initial?.shapes ?? [])
      .filter((s) => s.kind === 'rect')
      .map((s, i) => ({
        id: `${i}`,
        code: s.shelfCode,
        x: s.coords[0],
        y: s.coords[1],
        w: s.coords[2],
        h: s.coords[3],
        sides: !!s.sides,
      }))
  );
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<DrawnShelf | null>(null);
  const [publishing, setPublishing] = useState(false);

  function toSvgCoords(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEW;
    const y = ((e.clientY - rect.top) / rect.height) * VIEW;
    return {
      x: Math.max(0, Math.min(VIEW, x)),
      y: Math.max(0, Math.min(VIEW, y)),
    };
  }

  function onDown(e: React.PointerEvent) {
    setDraft(toSvgCoords(e));
  }
  function onMove(e: React.PointerEvent) {
    if (!draft) return;
    const p = toSvgCoords(e);
    setPreview({
      id: 'preview',
      code: '',
      x: Math.min(draft.x, p.x),
      y: Math.min(draft.y, p.y),
      w: Math.abs(p.x - draft.x),
      h: Math.abs(p.y - draft.y),
      sides: false,
    });
  }
  function onUp() {
    if (preview && preview.w > 2 && preview.h > 2) {
      setShelves((prev) => [
        ...prev,
        { ...preview, id: `s${prev.length}-${Math.round(preview.x)}` },
      ]);
    }
    setDraft(null);
    setPreview(null);
  }

  function update(id: string, patch: Partial<DrawnShelf>) {
    setShelves((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }
  function remove(id: string) {
    setShelves((prev) => prev.filter((s) => s.id !== id));
  }

  async function publish() {
    const named = shelves.filter((s) => s.code.trim());
    if (named.length === 0) return;
    setPublishing(true);
    try {
      const mapJson: FloorMapJson = {
        viewBox: { width: VIEW, height: VIEW },
        shapes: named.map((s) => ({
          shelfCode: s.code.trim(),
          kind: 'rect' as const,
          coords: [s.x, s.y, s.w, s.h],
          labelPos: [s.x + s.w / 2, s.y + s.h / 2] as [number, number],
          sides: s.sides,
        })),
      };
      const res = await publishMapAction({ storeId, ticketId, mapJson });
      if (res?.data?.success) {
        toast.success(t('published'));
        router.push('/admin/mapping');
      } else {
        toast.error('Failed to publish');
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-bold text-2xl">
          {t('title', { store: storeName })}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('hint')}</p>
        <p className="mt-1 text-muted-foreground text-xs">
          {t('existingShelves', {
            codes: existingCodes.length ? existingCodes.join(', ') : '—',
          })}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="aspect-square w-full touch-none rounded-lg border bg-muted/20"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          {/* grid */}
          {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((g) => (
            <g key={g}>
              <line
                x1={g}
                y1={0}
                x2={g}
                y2={VIEW}
                stroke="#0001"
                strokeWidth={0.2}
              />
              <line
                x1={0}
                y1={g}
                x2={VIEW}
                y2={g}
                stroke="#0001"
                strokeWidth={0.2}
              />
            </g>
          ))}
          {shelves.map((s) => (
            <g key={s.id}>
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rx={1}
                fill="#4f83cc55"
                stroke="#4f83cc"
                strokeWidth={0.4}
              />
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h / 2}
                fontSize={Math.min(s.w, s.h) * 0.4}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--foreground)"
              >
                {s.code || '?'}
              </text>
            </g>
          ))}
          {preview ? (
            <rect
              x={preview.x}
              y={preview.y}
              width={preview.w}
              height={preview.h}
              fill="#4f83cc33"
              stroke="#4f83cc"
              strokeWidth={0.3}
              strokeDasharray="1 1"
            />
          ) : null}
        </svg>

        <div className="flex flex-col gap-2">
          {shelves.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded border p-2"
            >
              <Input
                value={s.code}
                onChange={(e) => update(s.id, { code: e.target.value })}
                placeholder={t('shelfCode')}
                className="h-9 w-24"
              />
              <span className="flex items-center gap-1 text-sm">
                <Checkbox
                  checked={s.sides}
                  onCheckedChange={(v) => update(s.id, { sides: v === true })}
                  aria-label={t('sides')}
                />
                {t('sides')}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                onClick={() => remove(s.id)}
                aria-label={t('remove')}
              >
                <TrashIcon className="size-4" />
              </Button>
            </div>
          ))}
          {shelves.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('viewBoxNote')}</p>
          ) : null}
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => setShelves([])}>
          {t('clear')}
        </Button>
        <Button
          onClick={publish}
          disabled={
            publishing || shelves.filter((s) => s.code.trim()).length === 0
          }
        >
          {t('publish')}
        </Button>
      </div>
    </div>
  );
}
