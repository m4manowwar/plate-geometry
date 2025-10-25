import React, { useMemo, useRef, useState, useCallback } from "react";
import { format } from 'date-fns';
import { clamp, round3, uniqSorted, findClosestIndex } from "./utils";
import SVGCanvas from "./components/SVGCanvas";
import PedestalList from "./components/PedestalList";
import ExportPanel from "./components/ExportPanel";
import useStore from "./store";
import { saveAs } from "file-saver";

// --- Utility helpers ---
// const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
// const round3 = (n) => Math.round(n * 1000) / 1000; // for display
// const uniqSorted = (arr, eps = 1e-6) => {
//   const a = Array.from(new Set(arr.map((x) => Math.round(x / eps) * eps)));
//   a.sort((x, y) => x - y);
//   return a;
// };

// Finds the index of the value in a sorted array that is closest to the target value.
// const findClosestIndex = (arr, target) => {
//   let closest = Infinity;
//   let closestIndex = -1;
//   for (let i = 0; i < arr.length; i++) {
//     const diff = Math.abs(arr[i] - target);
//     if (diff < closest) {
//       closest = diff;
//       closestIndex = i;
//     }
//   }
//   return closestIndex;
// };


export default function App() {
  // Zustand state
  const {
    length,
    width,
    mesh,
    pedestalHeight,
    plateThickness,
    zOrientation,
    fileName,
    points,
    showMomentGroup,
    showOneWayShear,
    showTwoWayShear,
    setLength,
    setWidth,
    setMesh,
    setPedestalHeight,
    setPlateThickness,
    setZOrientation,
    setFileName,
    setPoints,
    setShowMomentGroup,
    setShowOneWayShear,
    setShowTwoWayShear,
  } = useStore();

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
    const maxId = points.length > 0 ? Math.max(...points.map((p) => p.id)) : 0;
    const newId = maxId + 1;
    setPoints((p) => [...p, { id: newId, x: newPointX, z: newPointZ, length: 0.5, width: 0.3 }]);
    setNewPointX(0);
    setNewPointZ(0);
  };

  // Compute grid lines that "respect" user points
  const { xLines, zLines } = useMemo(() => {
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

  // Combined plate groups for export
  const { groupedPlates, shearPlates, twoWayShearPlates } = useMemo(() => {
    const momentPlates = new Set();
    const oneWayShearPlates = new Set();
    const twoWayShearPlates = new Set();
    const nx_plates = xLines.length - 1;
    const nz_plates = zLines.length - 1;

    points.forEach(p => {
      const px_idx = findClosestIndex(xLines, p.x);
      const pz_idx = findClosestIndex(zLines, p.z);
      
      const num_x_plates_moment = Math.round(p.length / mesh);
      const num_z_plates_moment = Math.round(p.width / mesh);

      const start_x_idx_moment = Math.floor(px_idx - num_x_plates_moment / 2);
      const end_x_idx_moment = Math.ceil(px_idx + num_x_plates_moment / 2);

      const start_z_idx_moment = Math.floor(pz_idx - num_z_plates_moment / 2);
      const end_z_idx_moment = Math.ceil(pz_idx + num_z_plates_moment / 2);

      for (let xi = Math.max(0, start_x_idx_moment); xi < Math.min(nx_plates, end_x_idx_moment); xi++) {
        for (let zi = Math.max(0, start_z_idx_moment); zi < Math.min(nz_plates, end_z_idx_moment); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) {
            momentPlates.add(plateId);
          }
        }
      }

      const numPlatesToAddOneWay = Math.round(plateThickness / mesh);
      const start_x_idx_oneWay = start_x_idx_moment - numPlatesToAddOneWay;
      const end_x_idx_oneWay = end_x_idx_moment + numPlatesToAddOneWay;
      const start_z_idx_oneWay = start_z_idx_moment - numPlatesToAddOneWay;
      const end_z_idx_oneWay = end_z_idx_moment + numPlatesToAddOneWay;
      
      for (let xi = Math.max(0, start_x_idx_oneWay); xi < Math.min(nx_plates, end_x_idx_oneWay); xi++) {
        for (let zi = Math.max(0, start_z_idx_oneWay); zi < Math.min(nz_plates, end_z_idx_oneWay); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) {
            oneWayShearPlates.add(plateId);
          }
        }
      }

      const numPlatesToAddTwoWay = Math.round(plateThickness / (2 * mesh));
      const start_x_idx_2way = start_x_idx_moment - numPlatesToAddTwoWay;
      const end_x_idx_2way = end_x_idx_moment + numPlatesToAddTwoWay;
      const start_z_idx_2way = start_z_idx_moment - numPlatesToAddTwoWay;
      const end_z_idx_2way = end_z_idx_moment + numPlatesToAddTwoWay;
      
      for (let xi = Math.max(0, start_x_idx_2way); xi < Math.min(nx_plates, end_x_idx_2way); xi++) {
        for (let zi = Math.max(0, start_z_idx_2way); zi < Math.min(nz_plates, end_z_idx_2way); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) {
            twoWayShearPlates.add(plateId);
          }
        }
      }
    });

    return {
      groupedPlates: Array.from(momentPlates).sort((a,b) => a-b),
      shearPlates: Array.from(oneWayShearPlates).sort((a,b) => a-b),
      twoWayShearPlates: Array.from(twoWayShearPlates).sort((a,b) => a-b)
    };
  }, [points, xLines, zLines, plateIdByCoord, mesh, plateThickness]);

  // Calculate separate bounding boxes for each pedestal's groups for visualization
  const pedestalGroupBoundingBoxes = useMemo(() => {
    const getBoundingBoxForPlates = (plateIds) => {
      if (plateIds.length === 0) return null;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      plateIds.forEach(plateId => {
        const plate = plates.find(p => p.id === plateId);
        if (plate) {
          plate.nodes.forEach(nodeId => {
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
              minX = Math.min(minX, node.x);
              maxX = Math.max(maxX, node.x);
              minZ = Math.min(minZ, node.z);
              maxZ = Math.max(maxZ, node.z);
            }
          });
        }
      });
      return {
        x: minX,
        y: minZ,
        width: maxX - minX,
        height: maxZ - minZ,
      };
    };

    const momentBoxes = [];
    const oneWayShearBoxes = [];
    const twoWayShearBoxes = [];

    points.forEach(p => {
      const px_idx = findClosestIndex(xLines, p.x);
      const pz_idx = findClosestIndex(zLines, p.z);
      
      const nx_plates = xLines.length - 1;
      const nz_plates = zLines.length - 1;

      // Moment Group
      const momentPlatesForPedestal = new Set();
      const num_x_plates_moment = Math.round(p.length / mesh);
      const num_z_plates_moment = Math.round(p.width / mesh);
      const start_x_idx_moment = Math.floor(px_idx - num_x_plates_moment / 2);
      const end_x_idx_moment = Math.ceil(px_idx + num_x_plates_moment / 2);
      const start_z_idx_moment = Math.floor(pz_idx - num_z_plates_moment / 2);
      const end_z_idx_moment = Math.ceil(pz_idx + num_z_plates_moment / 2);
      for (let xi = Math.max(0, start_x_idx_moment); xi < Math.min(nx_plates, end_x_idx_moment); xi++) {
        for (let zi = Math.max(0, start_z_idx_moment); zi < Math.min(nz_plates, end_z_idx_moment); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) momentPlatesForPedestal.add(plateId);
        }
      }
      const momentBox = getBoundingBoxForPlates(Array.from(momentPlatesForPedestal));
      if (momentBox) momentBoxes.push(momentBox);

      // 1-Way Shear Group
      const oneWayShearPlatesForPedestal = new Set();
      const numPlatesToAddOneWay = Math.round(plateThickness / mesh);
      const start_x_idx_oneWay = start_x_idx_moment - numPlatesToAddOneWay;
      const end_x_idx_oneWay = end_x_idx_moment + numPlatesToAddOneWay;
      const start_z_idx_oneWay = start_z_idx_moment - numPlatesToAddOneWay;
      const end_z_idx_oneWay = end_z_idx_moment + numPlatesToAddOneWay;
      for (let xi = Math.max(0, start_x_idx_oneWay); xi < Math.min(nx_plates, end_x_idx_oneWay); xi++) {
        for (let zi = Math.max(0, start_z_idx_oneWay); zi < Math.min(nz_plates, end_z_idx_oneWay); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) oneWayShearPlatesForPedestal.add(plateId);
        }
      }
      const oneWayShearBox = getBoundingBoxForPlates(Array.from(oneWayShearPlatesForPedestal));
      if (oneWayShearBox) oneWayShearBoxes.push(oneWayShearBox);

      // 2-Way Shear Group
      const twoWayShearPlatesForPedestal = new Set();
      const numPlatesToAddTwoWay = Math.round(plateThickness / (2 * mesh));
      const start_x_idx_2way = start_x_idx_moment - numPlatesToAddTwoWay;
      const end_x_idx_2way = end_x_idx_moment + numPlatesToAddTwoWay;
      const start_z_idx_2way = start_z_idx_moment - numPlatesToAddTwoWay;
      const end_z_idx_2way = end_z_idx_moment + numPlatesToAddTwoWay;
      for (let xi = Math.max(0, start_x_idx_2way); xi < Math.min(nx_plates, end_x_idx_2way); xi++) {
        for (let zi = Math.max(0, start_z_idx_2way); zi < Math.min(nz_plates, end_z_idx_2way); zi++) {
          const plateId = plateIdByCoord.get(`${xi},${zi}`);
          if (plateId) twoWayShearPlatesForPedestal.add(plateId);
        }
      }
      const twoWayShearBox = getBoundingBoxForPlates(Array.from(twoWayShearPlatesForPedestal));
      if (twoWayShearBox) twoWayShearBoxes.push(twoWayShearBox);
    });

    return {
      moment: momentBoxes,
      oneWayShear: oneWayShearBoxes,
      twoWayShear: twoWayShearBoxes,
    };
  }, [points, xLines, zLines, plateIdByCoord, mesh, plateThickness, plates, nodes]);


  // Click to create a point
  const onSvgClick = useCallback((e) => {
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
    const maxId = points.length > 0 ? Math.max(...points.map(p => p.id)) : 0;
    const newId = maxId + 1;
    setPoints((p) => [...p, { id: newId, x: xMeters, z: zMeters, length: 0.5, width: 0.3 }]);
  }, [dragId, length, width, points, pxPerMeter]);

  // Drag to move a point (simple pointer drag)
  const onPointerDownPoint = useCallback((id) => (e) => {
    // Stop event propagation to prevent the click event from bubbling up to the SVG.
    e.stopPropagation();
    setDragId(id);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (dragId == null) return;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursorpt = pt.matrixTransform(svg.getScreenCTM().inverse());
    const xMeters = clamp(cursorpt.x / pxPerMeter, 0, length);
    const zMeters = clamp(cursorpt.y / pxPerMeter, 0, width);
    setPoints((arr) => arr.map((p) => (p.id === dragId ? { ...p, x: xMeters, z: zMeters } : p)));
  }, [dragId, length, width, pxPerMeter]);

  const onPointerUp = useCallback(() => {
    setDragId(null);
  }, []);

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

    if (groupedPlates.length > 0 || shearPlates.length > 0 || twoWayShearPlates.length > 0) {
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
      
      // 2-Way Shear group
      if (twoWayShearPlates.length > 0) {
        lines.push(...formatGroupLines("2_WAY_SHEAR", twoWayShearPlates));
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
  }, [nodes, plates, members, plateThickness, groupedPlates, shearPlates, twoWayShearPlates]);

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

  // State and ref for clipboard functionality
  const exportTextRef = useRef(null);
  const [copyMessage, setCopyMessage] = useState("");
  const handleCopyToClipboard = () => {
    if (exportTextRef.current) {
        exportTextRef.current.select();
        document.execCommand('copy');
        setCopyMessage("Copied!");
        setTimeout(() => setCopyMessage(""), 2000);
    }
  };

  const exportToJson = () => {
    const state = {
      length,
      width,
      mesh,
      pedestalHeight,
      plateThickness,
      zOrientation,
      fileName,
      points,
      showMomentGroup,
      showOneWayShear,
      showTwoWayShear,
    };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    saveAs(blob, "plate_geometry_state.json");
  };

  const importFromJson = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedState = JSON.parse(e.target.result);
        setLength(importedState.length);
        setWidth(importedState.width);
        setMesh(importedState.mesh);
        setPedestalHeight(importedState.pedestalHeight);
        setPlateThickness(importedState.plateThickness);
        setZOrientation(importedState.zOrientation);
        setFileName(importedState.fileName);
        setPoints(Array.isArray(importedState.points) ? importedState.points : []);
        setShowMomentGroup(importedState.showMomentGroup);
        setShowOneWayShear(importedState.showOneWayShear);
        setShowTwoWayShear(importedState.showTwoWayShear);
      } catch (error) {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };

  // Render sizes in pixels via viewBox (meters * pxPerMeter)
  const viewW = length * pxPerMeter;
  const viewH = width * pxPerMeter;

  const deletePoint = (id) => setPoints((arr) => arr.filter((p) => p.id !== id));

  // Ensure points is treated as an array before calling .map to prevent runtime errors
  const safePoints = Array.isArray(points) ? points : [];

  console.log("Points state:", points); // Debugging to verify points value

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
          <div className="flex flex-col">
            <label className="text-xs">Import JSON</label>
            <input
              type="file"
              accept="application/json"
              onChange={importFromJson}
              className="border rounded-xl px-3 py-2 w-56"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Export JSON</label>
            <button
              onClick={exportToJson}
              className="border px-3 py-2 rounded-2xl shadow-sm hover:shadow bg-indigo-600 text-white"
            >
              Export to JSON
            </button>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-slate-600">
              Origin at upper-left (0, 0, 0).
            </div>
            <div className="text-sm">
              Nodes: {nodes.length} · Plates: {plates.length} · Members: {members.length} · 2-Way Shear Plates: {twoWayShearPlates.length}
            </div>
          </div>
          <SVGCanvas
            length={length}
            width={width}
            pxPerMeter={pxPerMeter}
            xLines={xLines}
            zLines={zLines}
            nodes={nodes}
            points={safePoints}
            pedestalGroupBoundingBoxes={pedestalGroupBoundingBoxes}
            showMomentGroup={showMomentGroup}
            showOneWayShear={showOneWayShear}
            showTwoWayShear={showTwoWayShear}
            onSvgClick={onSvgClick}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerDownPoint={onPointerDownPoint}
          />
        </div>
        <div className="bg-white rounded-2xl shadow p-3">
          <div className="flex flex-wrap items-center justify-between font-medium mb-2 gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Add Pedestal At :</span>
              <label className="text-sm">X</label>
              <input
                className="border rounded-lg px-2 py-1 w-20"
                type="number"
                step="0.1"
                value={newPointX}
                onChange={(e) => setNewPointX(parseFloat(e.target.value) || 0)}
              />
              <label className="text-sm">Z</label>
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
                title="Add a new pedestal with specified X and Z coordinates"
              >
                Add Pedestal
              </button>
            </div>
            <button
              onClick={() => setPoints([])}
              className="border px-3 py-2 rounded-2xl shadow-sm hover:shadow bg-white"
              title="This action will delete all the pedestals"
            >
              Delete All Pedestals
            </button>
          </div>
          <PedestalList
            points={safePoints}
            setPoints={setPoints}
            length={length}
            width={width}
            deletePoint={deletePoint}
          />
        </div>
        <ExportPanel
          exportText={exportText}
          fileName={fileName}
          setFileName={setFileName}
          downloadTxt={downloadTxt}
        />
      </div>
      <footer className="text-center text-xs text-slate-500 mt-6">
        Upper-left origin (0,0,0). X → right, Z → down. Y is fixed at 0 for surface nodes. Mesh creates equal strips inside each segment bounded by pedestal and edges; remainder forms the last strip.
      </footer>
    </div>
  );
}
