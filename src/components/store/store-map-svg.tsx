'use client';

import type { FloorMapJson } from '@/db/store.schema';

/**
 * Data-driven floor-map renderer (requirements §4.1 section 5).
 *
 * Draws the shapes from the store's mapJson. The target shelf is highlighted in
 * red; neighbours render normally for orientation. Supports the "main shelf +
 * left/right side" structure and tapping a shelf to switch the highlight (used
 * when candidates span multiple shelves).
 */

const HIGHLIGHT = '#e5484d';

interface StoreMapSvgProps {
  mapJson: FloorMapJson;
  /** Shelf code to highlight in red. */
  highlight?: string | null;
  /** Optional: highlighted side (L/R) within the shelf. */
  highlightSide?: 'L' | 'R' | null;
  onSelectShelf?: (code: string) => void;
}

export function StoreMapSvg({
  mapJson,
  highlight,
  highlightSide,
  onSelectShelf,
}: StoreMapSvgProps) {
  const { width, height } = mapJson.viewBox;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full rounded-lg border bg-muted/20"
      role="img"
      aria-label="Store floor map"
    >
      {mapJson.shapes.map((shape) => {
        const isTarget = highlight && shape.shelfCode === highlight;
        const fill = isTarget ? HIGHLIGHT : 'var(--color-muted, #e5e5e5)';
        const stroke = isTarget ? HIGHLIGHT : 'var(--color-border, #999)';
        const textFill = isTarget ? '#fff' : 'var(--color-foreground, #333)';
        const clickable = !!onSelectShelf;

        if (shape.kind === 'rect') {
          const [x, y, w, h] = shape.coords;
          const labelX = shape.labelPos?.[0] ?? x + w / 2;
          const labelY = shape.labelPos?.[1] ?? y + h / 2;
          return (
            <g
              key={shape.shelfCode}
              onClick={
                clickable ? () => onSelectShelf(shape.shelfCode) : undefined
              }
              style={{ cursor: clickable ? 'pointer' : 'default' }}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={1.5}
                fill={fill}
                stroke={stroke}
                strokeWidth={isTarget ? 1 : 0.5}
              />
              {/* Left/right side markers when the shelf distinguishes sides */}
              {shape.sides ? (
                <>
                  <rect
                    x={x}
                    y={y}
                    width={Math.max(1.5, w * 0.12)}
                    height={h}
                    fill={
                      isTarget && highlightSide === 'L'
                        ? HIGHLIGHT
                        : 'transparent'
                    }
                    opacity={0.6}
                  />
                  <rect
                    x={x + w - Math.max(1.5, w * 0.12)}
                    y={y}
                    width={Math.max(1.5, w * 0.12)}
                    height={h}
                    fill={
                      isTarget && highlightSide === 'R'
                        ? HIGHLIGHT
                        : 'transparent'
                    }
                    opacity={0.6}
                  />
                </>
              ) : null}
              <text
                x={labelX}
                y={labelY}
                fontSize={Math.min(w, h) * 0.5}
                fontWeight="bold"
                fill={textFill}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {shape.shelfCode}
              </text>
            </g>
          );
        }

        // polygon
        const points: string[] = [];
        for (let i = 0; i + 1 < shape.coords.length; i += 2) {
          points.push(`${shape.coords[i]},${shape.coords[i + 1]}`);
        }
        const label = shape.labelPos ?? [
          shape.coords[0] ?? 0,
          shape.coords[1] ?? 0,
        ];
        return (
          <g
            key={shape.shelfCode}
            onClick={
              clickable ? () => onSelectShelf(shape.shelfCode) : undefined
            }
            style={{ cursor: clickable ? 'pointer' : 'default' }}
          >
            <polygon
              points={points.join(' ')}
              fill={fill}
              stroke={stroke}
              strokeWidth={isTarget ? 1 : 0.5}
            />
            <text
              x={label[0]}
              y={label[1]}
              fontSize={4}
              fontWeight="bold"
              fill={textFill}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {shape.shelfCode}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
