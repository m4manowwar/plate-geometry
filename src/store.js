import { create } from 'zustand';

const useStore = create((set, get) => ({
  // State variables
  length: 6,
  width: 4,
  mesh: 0.2,
  pedestalHeight: 0.0,
  plateThickness: 0.3,
  zOrientation: "down",
  fileName: "Plate Geometry.STD",
  points: [],
  showMomentGroup: true,
  showOneWayShear: true,
  showTwoWayShear: true,

  // Actions
  setLength: (length) => set({ length }),
  setWidth: (width) => set({ width }),
  setMesh: (mesh) => set({ mesh }),
  setPedestalHeight: (pedestalHeight) => set({ pedestalHeight }),
  setPlateThickness: (plateThickness) => set({ plateThickness }),
  setZOrientation: (zOrientation) => set({ zOrientation }),
  setFileName: (fileName) => set({ fileName }),
  setPoints: (pointsOrUpdater) => {
    if (typeof pointsOrUpdater === 'function') {
      set((state) => ({ points: Array.isArray(pointsOrUpdater(state.points)) ? pointsOrUpdater(state.points) : [] }));
    } else {
      set({ points: Array.isArray(pointsOrUpdater) ? pointsOrUpdater : [] });
    }
  },
  setShowMomentGroup: (showMomentGroup) => set({ showMomentGroup }),
  setShowOneWayShear: (showOneWayShear) => set({ showOneWayShear }),
  setShowTwoWayShear: (showTwoWayShear) => set({ showTwoWayShear }),
}));

export default useStore;