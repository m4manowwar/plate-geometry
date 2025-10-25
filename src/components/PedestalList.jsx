import React from "react";
import { clamp, round3 } from "../utils";

const PedestalList = ({
  points,
  setPoints,
  length,
  width,
  deletePoint,
}) => {
  return (
    <div className="space-y-2 max-h-64 overflow-auto pr-1">
      {points
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2">
            <span className="text-sm w-6">P{p.id}</span>
            <label className="text-sm">X</label>
            <input
              className="border rounded-lg px-2 py-1 w-20"
              type="number"
              step="0.1"
              value={round3(p.x)}
              onChange={(e) => {
                const v = clamp(parseFloat(e.target.value) || 0, 0, length);
                setPoints((arr) =>
                  arr.map((q) => (q.id === p.id ? { ...q, x: v } : q))
                );
              }}
            />
            <label className="text-sm">Z</label>
            <input
              className="border rounded-lg px-2 py-1 w-20"
              type="number"
              step="0.1"
              value={round3(p.z)}
              onChange={(e) => {
                const v = clamp(parseFloat(e.target.value) || 0, 0, width);
                setPoints((arr) =>
                  arr.map((q) => (q.id === p.id ? { ...q, z: v } : q))
                );
              }}
            />
            <label className="text-sm">L</label>
            <input
              className="border rounded-lg px-2 py-1 w-20"
              type="number"
              step="0.01"
              min={0.1}
              value={round3(p.length)}
              onChange={(e) => {
                const v = Math.max(0.1, parseFloat(e.target.value) || 0.1);
                setPoints((arr) =>
                  arr.map((q) => (q.id === p.id ? { ...q, length: v } : q))
                );
              }}
            />
            <label className="text-sm">W</label>
            <input
              className="border rounded-lg px-2 py-1 w-20"
              type="number"
              step="0.01"
              min={0.1}
              value={round3(p.width)}
              onChange={(e) => {
                const v = Math.max(0.1, parseFloat(e.target.value) || 0.1);
                setPoints((arr) =>
                  arr.map((q) => (q.id === p.id ? { ...q, width: v } : q))
                );
              }}
            />
            <button
              onClick={() => deletePoint(p.id)}
              className="ml-auto text-red-600 text-sm hover:underline"
            >
              Delete
            </button>
          </div>
        ))}
    </div>
  );
};

export default PedestalList;