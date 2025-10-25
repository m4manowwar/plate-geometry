import React, { useCallback } from "react";
import { clamp } from "../utils";

const SVGCanvas = ({
  length,
  width,
  pxPerMeter,
  xLines,
  zLines,
  nodes,
  points,
  pedestalGroupBoundingBoxes,
  showMomentGroup,
  showOneWayShear,
  showTwoWayShear,
  onSvgClick,
  onPointerMove,
  onPointerUp,
  onPointerDownPoint,
}) => {
  const viewW = length * pxPerMeter;
  const viewH = width * pxPerMeter;

  return (
    <svg
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
      {/* Moment Group Bounding Box */}
      {showMomentGroup && pedestalGroupBoundingBoxes.moment.map((box, i) => (
        <rect
          key={`moment-box-${i}`}
          x={box.x * pxPerMeter}
          y={box.y * pxPerMeter}
          width={box.width * pxPerMeter}
          height={box.height * pxPerMeter}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeDasharray="5,5"
        />
      ))}
      {/* 1-Way Shear Group Bounding Box */}
      {showOneWayShear && pedestalGroupBoundingBoxes.oneWayShear.map((box, i) => (
        <rect
          key={`one-way-box-${i}`}
          x={box.x * pxPerMeter}
          y={box.y * pxPerMeter}
          width={box.width * pxPerMeter}
          height={box.height * pxPerMeter}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeDasharray="5,5"
        />
      ))}
      {/* 2-Way Shear Group Bounding Box */}
      {showTwoWayShear && pedestalGroupBoundingBoxes.twoWayShear.map((box, i) => (
        <rect
          key={`two-way-box-${i}`}
          x={box.x * pxPerMeter}
          y={box.y * pxPerMeter}
          width={box.width * pxPerMeter}
          height={box.height * pxPerMeter}
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
          strokeDasharray="5,5"
        />
      ))}
      {/* Pedestal rectangles, circles, and labels */}
      {points.map((p) => (
        <g key={p.id} onPointerDown={onPointerDownPoint(p.id)}>
          {/* Transparent rectangle for pedestal dimensions */}
          <rect
            x={(p.x - p.length / 2) * pxPerMeter}
            y={(p.z - p.width / 2) * pxPerMeter}
            width={p.length * pxPerMeter}
            height={p.width * pxPerMeter}
            fill="#60a5fa"
            fillOpacity="0.3"
            stroke="#1e40af"
            strokeWidth="1.5"
          />
          {/* Circle at the center of the pedestal */}
          <circle cx={p.x * pxPerMeter} cy={p.z * pxPerMeter} r={8} fill="#1d4ed8" opacity={0.85} />
          {/* Text label for the pedestal */}
          <text x={p.x * pxPerMeter + 10} y={p.z * pxPerMeter - 10} fontSize={28} fill="#0f172a">
            P{p.id} ({clamp(p.x, 0, length)}, {clamp(p.z, 0, width)})
          </text>
        </g>
      ))}
      {/* Tiny node dots to visualize intersections (optional) */}
      {nodes.filter((n) => n.type === "surface").map((n) => (
        <circle key={n.id} cx={n.x * pxPerMeter} cy={n.z * pxPerMeter} r={2.2} fill="#64748b" />
      ))}
    </svg>
  );
};

export default SVGCanvas;