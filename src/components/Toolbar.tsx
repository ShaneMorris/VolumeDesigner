import { useRef } from 'react';
import { useDesignStore, type Mode } from '../store/designStore';
import { downloadDesignAsFile, readDesignFromFile } from '../persistence/storage';

const MODES: { id: Mode; label: string }[] = [
  { id: 'sketch', label: '1. Sketch Base' },
  { id: 'build', label: '2. Build Faces' },
  { id: 'angles', label: '3. Angles' },
  { id: 'holes', label: '4. Holes' },
  { id: 'unfold', label: '5. Unfold / Export' },
];

export function Toolbar() {
  const mode = useDesignStore((s) => s.mode);
  const setMode = useDesignStore((s) => s.setMode);
  const undo = useDesignStore((s) => s.undo);
  const redo = useDesignStore((s) => s.redo);
  const past = useDesignStore((s) => s.past);
  const future = useDesignStore((s) => s.future);
  const design = useDesignStore((s) => s.design);
  const loadDesign = useDesignStore((s) => s.loadDesign);
  const resetDesign = useDesignStore((s) => s.resetDesign);
  const frameView = useDesignStore((s) => s.frameView);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar">
      <div className="toolbar-title">Climbing Volume Modeler</div>
      <div className="toolbar-modes">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'mode-active' : ''} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="toolbar-actions">
        <button disabled={past.length === 0} onClick={undo} title="Undo">
          ↶ Undo
        </button>
        <button disabled={future.length === 0} onClick={redo} title="Redo">
          ↷ Redo
        </button>
        <button onClick={frameView} title="Zoom the camera to fit the whole model">
          ⤢ Fit view
        </button>
        <button
          onClick={() => {
            if (confirm('Start a new, empty design? Unsaved changes will be lost unless exported.')) {
              resetDesign();
            }
          }}
        >
          New
        </button>
        <button onClick={() => downloadDesignAsFile(design)}>Save JSON</button>
        <button onClick={() => fileInputRef.current?.click()}>Open JSON</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const loaded = await readDesignFromFile(file);
              loadDesign(loaded);
            } catch {
              alert('Could not read that file as a design JSON.');
            }
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
