import { useEffect, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { Viewport } from './components/viewport/Viewport';
import { SketchPanel } from './components/panels/SketchPanel';
import { BuildPanel } from './components/panels/BuildPanel';
import { AnglesPanel } from './components/panels/AnglesPanel';
import { HolesPanel } from './components/panels/HolesPanel';
import { UnfoldPanel } from './components/panels/UnfoldPanel';
import { DimensionsPanel } from './components/panels/DimensionsPanel';
import { useDesignStore } from './store/designStore';
import { loadFromLocalStorage, saveToLocalStorage } from './persistence/storage';
import './App.css';

function ModePanel() {
  const mode = useDesignStore((s) => s.mode);
  switch (mode) {
    case 'sketch':
      return <SketchPanel />;
    case 'build':
      return <BuildPanel />;
    case 'angles':
      return <AnglesPanel />;
    case 'holes':
      return <HolesPanel />;
    case 'unfold':
      return <UnfoldPanel />;
  }
}

function App() {
  const design = useDesignStore((s) => s.design);
  const loadDesign = useDesignStore((s) => s.loadDesign);
  const loadedInitial = useRef(false);

  useEffect(() => {
    if (loadedInitial.current) return;
    loadedInitial.current = true;
    const saved = loadFromLocalStorage();
    if (saved && (saved.vertices.length > 0 || saved.faces.length > 0)) {
      loadDesign(saved);
    }
  }, [loadDesign]);

  useEffect(() => {
    if (!loadedInitial.current) return;
    saveToLocalStorage(design);
  }, [design]);

  return (
    <div className="app-shell">
      <Toolbar />
      <div className="app-main">
        <div className="viewport-area">
          <Viewport />
        </div>
        <div className="side-panel">
          <div className="side-panel-mode">
            <ModePanel />
          </div>
          <hr />
          <DimensionsPanel />
        </div>
      </div>
    </div>
  );
}

export default App;
