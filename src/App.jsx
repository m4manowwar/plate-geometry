import React, { useMemo, useRef, useState } from "react";
import { format } from 'date-fns';

// --- Utility helpers ---
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const round3 = (n) => Math.round(n * 1000) / 1000; // for display
const uniqSorted = (arr, eps = 1e-6) => {
  const a = Array.from(new Set(arr.map((x) => Math.round(x / eps) * eps)));
  a.sort((x, y) => x - y);
  return a;
};

export default function App() {
  // Inputs (meters)
  const [length, setLength] = useState(6); // X
  const [width, setWidth] = useState(4);  // Z
  const [mesh, setMesh] = useState(0.2);  // square target size
  const [pedestalHeight, setPedestalHeight] = useState(0.0);
  const [plateThickness, setPlateThickness] = useState(0.3); // New state for plate thickness

  const [zOrientation, setZOrientation] = useState("down"); // "up" or "down"
  const [fileName, setFileName] = useState("Plate Geometry.STD");

  // Points placed by user (x,z,length,width). y is always 0 on the surface.
  const [points, setPoints] = useState([]); // {id, x, z, length, width}
  const nextPointId = useRef(1);

  // View / SVG
  const pxPerMeter = 120; // base scale; viewBox keeps it responsive
  const svgRef = useRef(null);
  
  // Drag state
  const [dragId, setDragId] = useState(null);

  // State for adding points manually
  const [newPointX, setNewPointX] = useState(0);
  const [newPointZ, setNewPointZ] = useState(0);

  // Function to add a point manually from input fields
  const addPointManually = () => {
    const id = nextPointId.current++;
    setPoints((p) => [...p, { id, x: newPointX, z: newPointZ, length: 0.5, width: 0.3 }]);
    setNewPointX(0);
    setNewPointZ(0);
  };

  // Compute grid lines that "respect" user points
  const { xLines, zLines } = useMemo(() => {
    // Seed with origin and far edges
    const xCuts = uniqSorted([0, length, ...points.map((p) => clamp(p.x, 0, length))]);
    const zCuts = uniqSorted([0, width, ...points.map((p) => clamp(p.z, 0, width))]);

    const addDivisions = (cuts, max, step) => {
      const lines = new Set(cuts);
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i];
        const b = cuts[i + 1];
        const span = b - a;
        if (span <= 0) continue;
        const k = Math.floor(span / step);
        for (let j = 1; j <= k; j++) {
          const t = a + j * step;
          if (t > a + 1e-9 && t < b - 1e-9) lines.add(t);
        }
      } 
      const arr = Array.from(lines);
      arr.sort((x, y) => x - y);
      return arr;
    };

    const xL = addDivisions(xCuts, length, mesh);
    const zL = addDivisions(zCuts, width, mesh);
    return { xLines: xL, zLines: zL };
  }, [points, length, width, mesh]);

  const { nodes, members, plates, plateIdByCoord } = useMemo(() => {
    const allNodes = [];
    const newMembers = [];
    const newPlates = [];
    const plateIdByCoord = new Map();
    let nodeIdCounter = 1;
    let plateIdCounter = 1;

    // Generate surface nodes (Y=0) and store mapping from point coords to node ID
    const surfaceNodesByCoord = {};
    for (let zi = 0; zi < zLines.length; zi++) {
      for (let xi = 0; xi < xLines.length; xi++) {
        const x = xLines[xi];
        const z = zLines[zi];
        const id = nodeIdCounter++;
        allNodes.push({ id, x, y: 0, z, type: 'surface' });
        surfaceNodesByCoord[`${round3(x)},${round3(z)}`] = id;
      }
    }

    // Generate pedestal nodes and members if pedestalHeight > 0
    if (pedestalHeight > 1e-9) {
      points.forEach(point => {
        const surfaceNodeId = surfaceNodesByCoord[`${round3(point.x)},${round3(point.z)}`];
        if (surfaceNodeId) {
          const newPedestalNodeId = nodeIdCounter++;
          allNodes.push({ id: newPedestalNodeId, x: point.x, y: pedestalHeight, z: point.z, type: 'pedestal' });
          // Link member to the original point data
          newMembers.push({
            id: newMembers.length + 1,
            startNode: surfaceNodeId,
            endNode: newPedestalNodeId,
            pointData: point
          });
        }
      });
    }

    // Generate plates
    const nX = xLines.length;
    const nodeIdAt = (xi, zi) => zi * nX + xi + 1; // Assuming surface nodes are numbered sequentially

    for (let zi = 0; zi < zLines.length - 1; zi++) {
      for (let xi = 0; xi < xLines.length - 1; xi++) {
        const tl = nodeIdAt(xi, zi); // top-left
        const tr = nodeIdAt(xi + 1, zi); // top-right
        const br = nodeIdAt(xi + 1, zi + 1); // bottom-right
        const bl = nodeIdAt(xi, zi + 1); // bottom-left

        const currentPlateId = plateIdCounter++;
        plateIdByCoord.set(`${xi},${zi}`, currentPlateId);

        let order;
        if (zOrientation === "up") {
          order = [bl, br, tr, tl];
        } else {
          order = [tl, tr, br, bl];
        }
        newPlates.push({ id: currentPlateId, nodes: order });
      }
    }

    return { nodes: allNodes, members: newMembers, plates: newPlates, plateIdByCoord };
  }, [xLines, zLines, pedestalHeight, points, zOrientation]);

  const { groupedPlates, shearPlates } = useMemo(() => {
    const momentPlates = new Set();
    const shearPlates = new Set();
    const nx_plates = xLines.length - 1;
    const nz_plates = zLines.length - 1;

    const numPlatesToAdd = Math.round(plateThickness / mesh);
    
    points.forEach(p => {
      // Find the grid indices of the pedestal's center point
      const px_idx = xLines.indexOf(p.x);
      const pz_idx = zLines.indexOf(p.z);

      if (px_idx === -1 || pz_idx === -1) {
        return; // Pedestal point not on a grid line, skip grouping for this point
      }
      
      const num_x_plates_moment = Math.round(p.length / mesh);
      const num_z_plates_moment = Math.round(p.width / mesh);

      // Determine the range of plate indices to include for Moment group
      const start_x_idx_moment = Math.floor(px_idx - num_x_plates_moment / 2);
      const end_x_idx_moment = Math.ceil(px_idx + num_x_plates_moment / 2);

      const start_z_idx_moment = Math.floor(pz_idx - num_z_plates_moment / 2);
      const end_z_idx_moment = Math.ceil(pz_idx + num_z_plates_moment / 2);

      // Add plates to Moment group
      for (let xi = Math.max(0, start_x_idx_moment); xi < Math.min(nx_plates, end_x_idx_moment); xi++) {
        for (let zi = Math.max(0, start_z_idx_moment); zi < Math.min(nz_plates, end_z_idx_moment); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) {
            momentPlates.add(plateId);
            shearPlates.add(plateId);
          }
        }
      }

      // Determine the range of plate indices to include for Shear group
      const start_x_idx_shear = Math.floor(px_idx - num_x_plates_moment / 2 - numPlatesToAdd);
      const end_x_idx_shear = Math.ceil(px_idx + num_x_plates_moment / 2 + numPlatesToAdd);
      
      const start_z_idx_shear = Math.floor(pz_idx - num_z_plates_moment / 2 - numPlatesToAdd);
      const end_z_idx_shear = Math.ceil(pz_idx + num_z_plates_moment / 2 + numPlatesToAdd);

      // Add plates to Shear group, including adjacent plates
      for (let xi = Math.max(0, start_x_idx_shear); xi < Math.min(nx_plates, end_x_idx_shear); xi++) {
        for (let zi = Math.max(0, start_z_idx_shear); zi < Math.min(nz_plates, end_z_idx_shear); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) {
            shearPlates.add(plateId);
          }
        }
      }
    });

    return {
      groupedPlates: Array.from(momentPlates).sort((a,b) => a-b),
      shearPlates: Array.from(shearPlates).sort((a,b) => a-b)
    };
  }, [points, xLines, zLines, plateIdByCoord, mesh, plateThickness]);


  // Click to create a point
  const onSvgClick = (e) => {
    // Only create a new point if there's no active drag operation.
    if (dragId !== null) {
      return;
    }
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursorpt = pt.matrixTransform(svg.getScreenCTM().inverse());
    const xMeters = clamp((cursorpt.x) / pxPerMeter, 0, length);
    const zMeters = clamp((cursorpt.y) / pxPerMeter, 0, width);
    const id = nextPointId.current++;
    setPoints((p) => [...p, { id, x: xMeters, z: zMeters, length: 0.5, width: 0.3 }]);
  };

  // Drag to move a point (simple pointer drag)
  const onPointerDownPoint = (id) => (e) => {
    // Stop event propagation to prevent the click event from bubbling up to the SVG.
    e.stopPropagation();
    setDragId(id);
  };
  const onPointerMove = (e) => {
    if (dragId == null) return;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursorpt = pt.matrixTransform(svg.getScreenCTM().inverse());
    const xMeters = clamp(cursorpt.x / pxPerMeter, 0, length);
    const zMeters = clamp(cursorpt.y / pxPerMeter, 0, width);
    setPoints((arr) => arr.map((p) => (p.id === dragId ? { ...p, x: xMeters, z: zMeters } : p)));
  };
  const onPointerUp = () => {
    setDragId(null);
  }

  // Delete a point
  const deletePoint = (id) => setPoints((arr) => arr.filter((p) => p.id !== id));

  // Helper function to format grouped lines with character limit
  const formatGroupLines = (groupName, ids) => {
    const lines = [];
    const charLimit = 60; // STAAD's default line width is 79, but groups are indented
    let currentLine = `_` + groupName.toUpperCase();
    for (const id of ids) {
      const idStr = String(id);
      const potentialNextLine = currentLine + " " + idStr;
      if (potentialNextLine.length > charLimit) {
        lines.push(currentLine + " -");
        currentLine = idStr;
      } else {
        currentLine = potentialNextLine;
      }
    }
    if (currentLine !== `_` + groupName.toUpperCase()) {
      lines.push(currentLine);
    }
    return lines;
  };

  // Export text in the prescribed format
  const exportText = useMemo(() => {
    const lines = [];
    const formattedDate = format(new Date(), 'dd-MMM-yy');
    lines.push("STAAD SPACE");
    lines.push("START JOB INFORMATION");
    lines.push("ENGINEER DATE " + formattedDate);
    lines.push("END JOB INFORMATION");
    lines.push("INPUT WIDTH 79");
    lines.push("UNIT METER KN");
    lines.push("JOINT COORDINATES");
    
    // Format joint coordinates with a 74 character limit
    const charLimit = 74;
    let currentLine = '';
    nodes.forEach((n, index) => {
      const jointStr = `${n.id} ${round3(n.x)} ${round3(n.y)} ${round3(n.z)}`;
      if (currentLine === '') {
        currentLine = jointStr;
      } else if ((currentLine + '; ' + jointStr).length <= charLimit) {
        currentLine += '; ' + jointStr;
      } else {
        lines.push(currentLine + ';');
        currentLine = jointStr;
      }
    });
    if (currentLine !== '') {
      lines.push(currentLine + ';');
    }
    
    lines.push("ELEMENT INCIDENCES SHELL");
    
    // Format plate incidences with a 74 character limit
    currentLine = '';
    plates.forEach((p, index) => {
      const plateStr = `${p.id} ${p.nodes.join(" ")}`;
      if (currentLine === '') {
        currentLine = plateStr;
      } else if ((currentLine + '; ' + plateStr).length <= charLimit) {
        currentLine += '; ' + plateStr;
      } else {
        lines.push(currentLine + ';');
        currentLine = plateStr;
      }
    });
    if (currentLine !== '') {
      lines.push(currentLine + ';');
    }

    if (groupedPlates.length > 0 || shearPlates.length > 0) {
      lines.push("START GROUP DEFINITION");
      lines.push("ELEMENT");
      
      // Moment group
      if (groupedPlates.length > 0) {
        lines.push(...formatGroupLines("MOMENT", groupedPlates));
      }

      // 1-Way Shear group
      if (shearPlates.length > 0) {
        lines.push(...formatGroupLines("1_WAY_SHEAR", shearPlates));
      }

      lines.push("END GROUP DEFINITION");
    }

    // Add plate properties
    if (plates.length > 0) {
      lines.push("ELEMENT PROPERTY");
      lines.push(`1 TO ${plates.length} THICKNESS ${round3(plateThickness)};`);
    }

    const lastPlateId = plates.length > 0 ? plates[plates.length - 1].id : 0;
    let memberIdCounter = lastPlateId + 1;

    if (members.length > 0) {
      lines.push("MEMBER INCIDENCES");
      // Use the memberIdCounter for correct member IDs in STAAD
      const memberIdMap = new Map();
      members.forEach((m) => {
        const memberId = memberIdCounter++;
        memberIdMap.set(m.pointData.id, memberId); // Store mapping for property assignment
        lines.push(`${memberId} ${m.startNode} ${m.endNode};`);
      });

      lines.push("DEFINE MATERIAL START");
      lines.push("ISOTROPIC CONCRETE");
      lines.push("E 2.17185e+07");
      lines.push("POISSON 0.17");
      lines.push("DENSITY 23.5616");
      lines.push("ALPHA 1e-05");
      lines.push("DAMP 0.05");
      lines.push("G 9.28139e+06");
      lines.push("TYPE CONCRETE");
      lines.push("STRENGTH FCU 27579");
      lines.push("END DEFINE MATERIAL");

      lines.push("CONSTANTS");
      lines.push("MATERIAL CONCRETE ALL");
      lines.push("MEMBER PROPERTY");
      // Use the pointData linked to each member to get its dimensions
      members.forEach((m) => {
        const memberId = memberIdMap.get(m.pointData.id);
        if (memberId) {
          lines.push(`${memberId} PRISM YD ${round3(m.pointData.length)} ZD ${round3(m.pointData.width)};`);
        }
      });
    }

    lines.push("FINISH");
    return lines.join("\n");
  }, [nodes, plates, members, plateThickness, groupedPlates, shearPlates]);

  // Export with filename
  const downloadTxt = () => {
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.trim() !== "" ? fileName : "mesh_nodes_plates.STD";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Render sizes in pixels via viewBox (meters * pxPerMeter)
  const viewW = length * pxPerMeter;
  const viewH = width * pxPerMeter;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs">Z Orientation</label>
            <select
              className="border rounded-xl px-3 py-2 w-32"
              value={zOrientation}
              onChange={(e) => setZOrientation(e.target.value)}
            >
              <option value="up">Z Up</option>
              <option value="down">Z Down</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Export File Name</label>
            <input
              className="border rounded-xl px-3 py-2 w-56"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Length X (m)</label>
            <input
              className="border rounded-xl px-3 py-2 w-28"
              type="number"
              step="0.1"
              min={0.1}
              value={length}
              onChange={(e) => setLength(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Width Z (m)</label>
            <input
              className="border rounded-xl px-3 py-2 w-28"
              type="number"
              step="0.1"
              min={0.1}
              value={width}
              onChange={(e) => setWidth(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Mesh (m)</label>
            <input
              className="border rounded-xl px-3 py-2 w-28"
              type="number"
              step="0.05"
              min={0.05}
              value={mesh}
              onChange={(e) => setMesh(Math.max(0.01, parseFloat(e.target.value) || 0.5))}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Pedestal Height (m)</label>
            <input
              className="border rounded-xl px-3 py-2 w-28"
              type="number"
              step="0.1"
              value={pedestalHeight}
              onChange={(e) => setPedestalHeight(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Plate Thickness (m)</label>
            <input
              className="border rounded-xl px-3 py-2 w-28"
              type="number"
              step="0.01"
              min={0.01}
              value={plateThickness}
              onChange={(e) => setPlateThickness(parseFloat(e.target.value) || 0.01)}
            />
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-slate-600">
              Origin at upper-left (0, 0, 0). Click to add points. Drag points to modify.
            </div>
            <div className="text-sm">Nodes: {nodes.length} · Plates: {plates.length} · Members: {members.length}</div>
          </div>
          <div className="overflow-auto border rounded-xl">
            <svg
              ref={svgRef}
              className={`w-full h-[480px] touch-none select-none`}
              viewBox={`0 0 ${viewW} ${viewH}`}
              onClick={onSvgClick}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* Surface background */}
              <rect x={0} y={0} width={viewW} height={viewH} fill="#f8fafc" />
              {/* Outer border */}
              <rect x={0} y={0} width={viewW} height={viewH} fill="none" stroke="#0f172a" strokeWidth={2} />
              {/* Grid lines (respecting points) */}
              {xLines.map((x, i) => (
                <line key={`vx-${i}`} x1={x * pxPerMeter} y1={0} x2={x * pxPerMeter} y2={viewH} stroke="#cbd5e1" strokeWidth={1} />
              ))}
              {zLines.map((z, i) => (
                <line key={`hz-${i}`} x1={0} y1={z * pxPerMeter} x2={viewW} y2={z * pxPerMeter} stroke="#cbd5e1" strokeWidth={1} />
              ))}
              {/* User points */}
              {points.map((p) => (
                <g key={p.id} onPointerDown={onPointerDownPoint(p.id)}>
                  <circle cx={p.x * pxPerMeter} cy={p.z * pxPerMeter} r={8} fill="#1d4ed8" opacity={0.85} />
                  <text x={p.x * pxPerMeter + 10} y={p.z * pxPerMeter - 10} fontSize={28} fill="#0f172a">
                    P{p.id} ({round3(p.x)}, {round3(p.z)})
                  </text>
                </g>
              ))}
              {/* Tiny node dots to visualize intersections (optional) */}
              {nodes.filter(n => n.type === 'surface').map((n) => (
                <circle key={n.id} cx={n.x * pxPerMeter} cy={n.z * pxPerMeter} r={2.2} fill="#64748b" />
              ))}
            </svg>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow p-3">
          <div className="flex flex-wrap items-center justify-between font-medium mb-2 gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">User Points :</span>
              <label className="text-sm">x</label>
              <input
                className="border rounded-lg px-2 py-1 w-20"
                type="number"
                step="0.1"
                value={newPointX}
                onChange={(e) => setNewPointX(parseFloat(e.target.value) || 0)}
              />
              <label className="text-sm">z</label>
              <input
                className="border rounded-lg px-2 py-1 w-20"
                type="number"
                step="0.1"
                value={newPointZ}
                onChange={(e) => setNewPointZ(parseFloat(e.target.value) || 0)}
              />
              <button
                onClick={addPointManually}
                className="border px-3 py-2 rounded-2xl shadow-sm hover:shadow bg-indigo-600 text-white"
                title="Add a new user point with specified X and Z coordinates"
              >
                Add Point
              </button>
            </div>
            <button
              onClick={() => setPoints([])}
              className="border px-3 py-2 rounded-2xl shadow-sm hover:shadow bg-white"
              title="Clear all user points"
            >
              Clear Points
            </button>
          </div>
          {points.length === 0 && (
            <div className="text-sm text-slate-600">Click on the surface to create points. Drag a point to move it.</div>
          )}
          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {points
              .slice()
              .sort((a, b) => a.id - b.id)
              .map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm w-6">P{p.id}</span>
                  <label className="text-sm">x</label>
                  <input
                    className="border rounded-lg px-2 py-1 w-20"
                    type="number"
                    step="0.1"
                    value={round3(p.x)}
                    onChange={(e) => {
                      const v = clamp(parseFloat(e.target.value) || 0, 0, length);
                      setPoints((arr) => arr.map((q) => (q.id === p.id ? { ...q, x: v } : q)));
                    }}
                  />
                  <label className="text-sm">z</label>
                  <input
                    className="border rounded-lg px-2 py-1 w-20"
                    type="number"
                    step="0.1"
                    value={round3(p.z)}
                    onChange={(e) => {
                      const v = clamp(parseFloat(e.target.value) || 0, 0, width);
                      setPoints((arr) => arr.map((q) => (q.id === p.id ? { ...q, z: v } : q)));
                    }}
                  />
                  {/* New inputs for length and width */}
                  <label className="text-sm">L</label>
                  <input
                    className="border rounded-lg px-2 py-1 w-20"
                    type="number"
                    step="0.01"
                    min={0.1}
                    value={round3(p.length)}
                    onChange={(e) => {
                      const v = Math.max(0.1, parseFloat(e.target.value) || 0.1);
                      setPoints((arr) => arr.map((q) => (q.id === p.id ? { ...q, length: v } : q)));
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
                      setPoints((arr) => arr.map((q) => (q.id === p.id ? { ...q, width: v } : q)));
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
        </div>
        <div className="bg-white rounded-2xl shadow p-3">
          <div className="font-medium mb-2">Export Preview</div>
          <textarea
            className="w-full min-h-[720px] border rounded-xl p-2 text-xs font-mono"
            readOnly
            value={exportText}
          />
          <div className="flex justify-end mt-2">
            <button onClick={downloadTxt} className="border px-3 py-2 rounded-2xl shadow-sm hover:shadow bg-indigo-600 text-white">
              Download File
            </button>
          </div>
        </div>
      </div>
      <footer className="text-center text-xs text-slate-500 mt-6">
        Upper-left origin (0,0,0). X → right, Z → down. Y is fixed at 0 for surface nodes. Mesh creates equal strips inside each segment bounded by user points and edges; remainder forms the last strip.
      </footer>
    </div>
  );
}
