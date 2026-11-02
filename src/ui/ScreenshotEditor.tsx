import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Check, Crop, RotateCcw, Trash2 } from 'lucide-react';
import type { Report } from '../shared/types';
import { MAX_SCREENSHOT_LENGTH } from '../core';

type Screenshot = NonNullable<Report['screenshot']>;
type Rectangle = { x: number; y: number; width: number; height: number };

export function ScreenshotEditor({
  screenshot,
  disabled,
  onChange,
  onRemove,
  onRetake,
}: {
  screenshot: Screenshot;
  disabled: boolean;
  onChange: (value: Screenshot) => void;
  onRemove: () => void;
  onRetake: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [rect, setRect] = useState<Rectangle>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  useEffect(() => {
    let alive = true;
    setReady(false);
    setError('');
    setRect({ x: 0, y: 0, width: 0, height: 0 });
    const image = new Image();
    image.onload = () => {
      if (!alive || !canvas.current) return;
      canvas.current.width = image.naturalWidth;
      canvas.current.height = image.naturalHeight;
      canvas.current.getContext('2d')?.drawImage(image, 0, 0);
      setReady(true);
    };
    image.onerror = () => {
      if (alive)
        setError('Screenshot could not be displayed. Retake or remove it.');
    };
    image.src = screenshot.dataUrl;
    return () => {
      alive = false;
    };
  }, [screenshot.dataUrl]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(
        Math.max(
          0,
          Math.min(
            event.currentTarget.width,
            ((event.clientX - bounds.left) * event.currentTarget.width) /
              bounds.width,
          ),
        ),
      ),
      y: Math.round(
        Math.max(
          0,
          Math.min(
            event.currentTarget.height,
            ((event.clientY - bounds.top) * event.currentTarget.height) /
              bounds.height,
          ),
        ),
      ),
    };
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!start.current) return;
    const end = point(event);
    setRect({
      x: Math.min(start.current.x, end.x),
      y: Math.min(start.current.y, end.y),
      width: Math.abs(end.x - start.current.x),
      height: Math.abs(end.y - start.current.y),
    });
  }
  function apply() {
    if (!canvas.current || !ready || disabled) return;
    if (rect.width <= 0 || rect.height <= 0) return;
    const result = document.createElement('canvas');
    result.width = canvas.current.width;
    result.height = canvas.current.height;
    const ctx = result.getContext('2d');
    if (!ctx) {
      setError('Image editing is unavailable in this browser.');
      return;
    }
    ctx.drawImage(canvas.current, 0, 0);
    const width = Math.min(rect.width, canvas.current.width - rect.x);
    const height = Math.min(rect.height, canvas.current.height - rect.y);
    if (width <= 0 || height <= 0) {
      setError('Select an area inside the screenshot.');
      return;
    }
    ctx.fillStyle = '#000000';
    ctx.fillRect(rect.x, rect.y, width, height);
    const dataUrl = result.toDataURL('image/png');
    if (dataUrl.length > MAX_SCREENSHOT_LENGTH) {
      setError(
        'The redacted image exceeds the local storage limit. Remove the screenshot or retake it in a smaller browser window before exporting. This redaction has not been saved.',
      );
      return;
    }
    setError('');
    onChange({
      dataUrl,
      width: canvas.current.width,
      height: canvas.current.height,
      redacted: true,
    });
  }
  const selected = rect.width > 0 && rect.height > 0;
  return (
    <section
      className="panel screenshot-panel"
      aria-labelledby="screenshot-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="screenshot-heading">Screenshot</h2>
          <p>Only the visible viewport. Nothing is uploaded.</p>
        </div>
        <span className="subtle-pill">
          {screenshot.width} × {screenshot.height}
        </span>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="screenshot-frame">
        <div className="canvas-wrap">
          <canvas
            ref={canvas}
            aria-label="Captured webpage screenshot. Drag to select a redaction area, or use the coordinate fields below."
            onPointerDown={(event) => {
              if (disabled || !ready) return;
              start.current = point(event);
              event.currentTarget.setPointerCapture(event.pointerId);
              setRect({ ...start.current, width: 0, height: 0 });
            }}
            onPointerMove={move}
            onPointerUp={(event) => {
              move(event);
              start.current = null;
            }}
            onPointerCancel={() => {
              start.current = null;
            }}
          />
          {selected && (
            <div
              className="redaction-selection"
              aria-hidden="true"
              style={{
                left: `${(rect.x / screenshot.width) * 100}%`,
                top: `${(rect.y / screenshot.height) * 100}%`,
                width: `${(rect.width / screenshot.width) * 100}%`,
                height: `${(rect.height / screenshot.height) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      <div className="screenshot-help">
        <Crop size={16} />
        <span>
          Drag over private information, then apply an opaque redaction.
        </span>
      </div>
      <div className="redaction-controls">
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <label key={key}>
            {key === 'x' || key === 'y' ? key.toUpperCase() : key}
            <input
              aria-label={`Redaction ${key}`}
              type="number"
              min="0"
              max={
                key === 'x' || key === 'width'
                  ? screenshot.width
                  : screenshot.height
              }
              step="1"
              value={rect[key]}
              disabled={disabled || !ready}
              onChange={(event) =>
                setRect((current) => ({
                  ...current,
                  [key]: Math.max(
                    0,
                    Math.min(
                      key === 'x' || key === 'width'
                        ? screenshot.width
                        : screenshot.height,
                      Math.round(Number(event.target.value) || 0),
                    ),
                  ),
                }))
              }
            />
          </label>
        ))}
        <button
          className="button secondary"
          onClick={apply}
          disabled={disabled || !ready || !selected}
        >
          <Check size={15} />
          Apply redaction
        </button>
      </div>
      <div className="screenshot-footer">
        <p>
          {screenshot.redacted
            ? 'Redactions are baked into the image. Retake to restore the original view.'
            : 'Screenshots may include private information. Review every visible area.'}
        </p>
        <div className="button-row">
          <button
            className="text-button"
            disabled={disabled}
            onClick={onRetake}
          >
            <RotateCcw size={14} />
            Retake
          </button>
          <button
            className="text-button danger"
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 size={14} />
            Remove
          </button>
        </div>
      </div>
    </section>
  );
}
