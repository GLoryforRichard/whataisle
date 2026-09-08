'use client';
import { useEffect, useRef, useState } from 'react';
import { C, FONT, SHADOW } from '@/lib/theme';
import { useStoreRuntime } from './StoreRuntimeProvider';
import type { FloorMap, MapShelf } from '@/lib/floor-map-model.mjs';
const EMPTY: FloorMap = { revision: 0, width: 1200, height: 900, shelves: [] };
const button: React.CSSProperties = {
  minHeight: 44,
  padding: '10px 14px',
  border: `2px solid ${C.border}`,
  borderRadius: 10,
  background: C.white,
  color: C.text,
  fontFamily: FONT,
  fontWeight: 700,
  cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  minHeight: 44,
  boxSizing: 'border-box',
  border: `2px solid ${C.border}`,
  borderRadius: 10,
  padding: '8px 10px',
  background: C.white,
  color: C.text,
  fontFamily: FONT,
};
export default function FloorMapEditor({ owner = false }: { owner?: boolean }) {
  const { store } = useStoreRuntime();
  const [map, setMap] = useState<FloorMap>(store.map || EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<'draw' | 'select' | 'pan'>('draw');
  const [confirm, setConfirm] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(100);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    original: MapShelf;
    draw: boolean;
  } | null>(null);
  const draftKey = `whataisle:map:${store.storeId}:${owner ? 'owner' : 'setup'}:${store.map?.revision || 0}`;
  useEffect(() => {
    try {
      const text = localStorage.getItem(draftKey);
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.shelves) && parsed.revision === (store.map?.revision || 0))
          setMap(parsed);
      }
    } catch {
      /* Storage unavailable: keep the in-memory draft. */
    }
    setLoaded(true);
  }, [draftKey, store.map?.revision]);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(draftKey, JSON.stringify(map));
      } catch {
        setError('本机存储已满，请保持此页打开并确认保存。 / Keep this page open until you save.');
      }
    }
  }, [map, draftKey, loaded]);
  const current = map.shelves.find((s) => s.id === selected);
  const update = (id: string, patch: Partial<MapShelf>) =>
    setMap((previous) => ({
      ...previous,
      shelves: previous.shelves.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  const point = (event: React.PointerEvent) => {
    const matrix = svg.current?.getScreenCTM();
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix?.inverse());
    return {
      x: Math.max(0, Math.min(map.width, Math.round(p.x / 10) * 10)),
      y: Math.max(0, Math.min(map.height, Math.round(p.y / 10) * 10)),
    };
  };
  const down = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || mode === 'pan') return;
    const { x, y } = point(event);
    const target = (event.target as Element).closest('[data-shelf]')?.getAttribute('data-shelf');
    const original = map.shelves.find((s) => s.id === target);
    if (original) {
      setSelected(original.id);
      gesture.current = { id: original.id, x, y, original, draw: false };
    } else if (mode === 'draw' && map.shelves.length < 250) {
      const id = `s_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      let n = map.shelves.length + 1;
      while (map.shelves.some((s) => s.code === `A${n}`)) n++;
      const shelf = {
        id,
        code: `A${n}`,
        description: '',
        x: Math.min(x, map.width - 40),
        y: Math.min(y, map.height - 40),
        w: 40,
        h: 40,
      };
      setMap((previous) => ({ ...previous, shelves: [...previous.shelves, shelf] }));
      setSelected(id);
      gesture.current = { id, x: shelf.x, y: shelf.y, original: shelf, draw: true };
    } else setSelected('');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = point(event);
    if (g.draw) {
      const x = Math.min(g.x, p.x),
        y = Math.min(g.y, p.y);
      update(g.id, {
        x,
        y,
        w: Math.min(map.width - x, Math.max(20, Math.abs(p.x - g.x))),
        h: Math.min(map.height - y, Math.max(20, Math.abs(p.y - g.y))),
      });
    } else
      update(g.id, {
        x: Math.max(0, Math.min(map.width - g.original.w, g.original.x + p.x - g.x)),
        y: Math.max(0, Math.min(map.height - g.original.h, g.original.y + p.y - g.y)),
      });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/store-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map, pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      window.location.assign(owner ? '/' : '/admin?opened=1');
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试。');
      setPin('');
      setBusy(false);
    }
  };
  if (!loaded) return null;
  return (
    <main
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: C.bg,
        color: C.text,
        fontFamily: FONT,
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          borderBottom: `2px solid ${C.border}`,
          background: C.white,
        }}
      >
        <div style={{ flex: 1, minWidth: 160 }}>
          <strong style={{ fontSize: 20 }}>{store.displayName}</strong>
          <div style={{ fontSize: 12 }}>
            {owner ? '编辑平面图 / Edit floor map' : '绘制货架平面图 / Draw shelf layout'}
          </div>
        </div>
        <button
          style={{ ...button, background: mode === 'draw' ? C.accent : C.white }}
          aria-pressed={mode === 'draw'}
          onClick={() => setMode('draw')}
        >
          ＋ 绘制货架 / Draw
        </button>
        <button
          style={{ ...button, background: mode === 'select' ? C.accent : C.white }}
          aria-pressed={mode === 'select'}
          onClick={() => setMode('select')}
        >
          移动 / Move
        </button>
        <button
          style={{ ...button, background: mode === 'pan' ? C.accent : C.white }}
          aria-pressed={mode === 'pan'}
          onClick={() => setMode('pan')}
        >
          拖动画布 / Pan
        </button>
        <button
          style={{ ...button, background: C.primary, boxShadow: SHADOW }}
          disabled={!map.shelves.length}
          onClick={() => setConfirm(true)}
        >
          确认保存 / Confirm
        </button>
      </header>
      <p style={{ margin: '8px 16px', fontSize: 13 }}>
        拖动画出货架，点选货架修改编号、尺寸或拖动位置。草稿只保存在本机。 / Drag to draw. Select a
        shelf to move or rename it. Draft stays on this device.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '0 16px 8px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label>
          缩放 / Zoom{' '}
          <input
            aria-label="Map zoom"
            type="range"
            min="50"
            max="180"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <span>{map.shelves.length} 个货架 / shelves</span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 200,
          overflow: 'auto',
          background: C.white,
          margin: '0 12px',
          border: `1px solid ${C.border}`,
          borderRadius: 12,
        }}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${map.width} ${map.height}`}
          role="img"
          aria-label="货架绘制画板 / Shelf layout canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => {
            gesture.current = null;
          }}
          onPointerCancel={() => {
            gesture.current = null;
          }}
          style={{
            display: 'block',
            width: `${zoom}%`,
            height: `${zoom}%`,
            minHeight: '100%',
            touchAction: mode === 'pan' ? 'pan-x pan-y' : 'none',
            userSelect: 'none',
          }}
        >
          <defs>
            <pattern id="floor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke={C.border}
                strokeOpacity="0.12"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width={map.width} height={map.height} fill="url(#floor-grid)" />
          {map.shelves.map((s) => (
            <g key={s.id} data-shelf={s.id} style={{ cursor: 'move' }}>
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rx="5"
                fill={s.id === selected ? C.accent : C.primarySofter}
                stroke={C.text}
                strokeWidth={s.id === selected ? 4 : 2}
              />
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="20"
                fontWeight="700"
                pointerEvents="none"
              >
                {s.code}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <footer
        style={{
          padding: 12,
          minHeight: 68,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {current ? (
          <>
            <label>
              编号 / Label{' '}
              <input
                aria-label="Shelf label"
                style={{ ...inputStyle, width: 100 }}
                maxLength={20}
                value={current.code}
                onChange={(e) => update(current.id, { code: e.target.value })}
              />
            </label>
            <label>
              说明 / Description{' '}
              <input
                aria-label="Shelf description"
                style={{ ...inputStyle, width: 150 }}
                maxLength={120}
                value={current.description}
                onChange={(e) => update(current.id, { description: e.target.value })}
              />
            </label>
            <label>
              宽 / W{' '}
              <input
                style={{ ...inputStyle, width: 68 }}
                type="number"
                min="20"
                max={map.width - current.x}
                value={current.w}
                onChange={(e) =>
                  update(current.id, {
                    w: Math.max(20, Math.min(map.width - current.x, Number(e.target.value))),
                  })
                }
              />
            </label>
            <label>
              高 / H{' '}
              <input
                style={{ ...inputStyle, width: 68 }}
                type="number"
                min="20"
                max={map.height - current.y}
                value={current.h}
                onChange={(e) =>
                  update(current.id, {
                    h: Math.max(20, Math.min(map.height - current.y, Number(e.target.value))),
                  })
                }
              />
            </label>
            <button
              style={button}
              disabled={!!store.map?.shelves.some((s) => s.id === selected)}
              onClick={() => {
                setMap((previous) => ({
                  ...previous,
                  shelves: previous.shelves.filter((s) => s.id !== selected),
                }));
                setSelected('');
              }}
            >
              删除 / Remove
            </button>
          </>
        ) : (
          <span>
            在空白处拖动绘制货架，或点选已有货架。 / Draw a shelf or select an existing one.
          </span>
        )}
      </footer>
      {error && (
        <p role="alert" style={{ padding: '0 16px', color: C.text }}>
          {error}
        </p>
      )}
      {confirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,.45)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <form
            onSubmit={save}
            role="dialog"
            aria-modal="true"
            aria-label="确认保存平面图"
            style={{
              background: C.white,
              border: `2px solid ${C.border}`,
              borderRadius: 16,
              padding: 24,
              width: '100%',
              maxWidth: 420,
            }}
          >
            <h2>确认平面图 / Confirm layout</h2>
            <p>
              {owner
                ? '保存后，商品仍关联原货架。 / Product locations stay attached to their shelves.'
                : store.searchReady
                  ? '保存地图和货架后，即可进入员工工作台上传照片。 / Save the map and shelves, then upload photos in the staff workspace.'
                  : '确认后保存地图和货架，准备完成后开放照片上传。 / Confirm to save the map and shelves. Photo upload opens when preparation is complete.'}
            </p>
            {!owner && (
              <label>
                6 位商店密码 / 6-digit store password
                <input
                  autoFocus
                  aria-label="Store password"
                  type="password"
                  autoComplete="off"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  style={{
                    ...inputStyle,
                    display: 'block',
                    minHeight: 48,
                    width: '100%',
                    fontSize: 24,
                    margin: '12px 0',
                  }}
                />
              </label>
            )}
            {error && <p role="alert">{error}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={busy}
                style={button}
                onClick={() => {
                  setConfirm(false);
                  setPin('');
                }}
              >
                返回修改 / Back
              </button>
              <button type="submit" disabled={busy} style={{ ...button, background: C.primary }}>
                {busy ? '保存中…' : '确认保存 / Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
