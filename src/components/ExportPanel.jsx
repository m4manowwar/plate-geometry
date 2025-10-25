import React, { useRef } from "react";

const ExportPanel = ({ exportText, fileName, setFileName, downloadTxt }) => {
  const exportTextRef = useRef(null);
  const [copyMessage, setCopyMessage] = React.useState("");

  const handleCopyToClipboard = () => {
    if (exportTextRef.current) {
      navigator.clipboard.writeText(exportText).then(() => {
        setCopyMessage("Copied!");
        setTimeout(() => setCopyMessage(""), 2000);
      });
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow p-3">
      <div className="flex justify-between items-center mb-2">
        <div className="font-medium">Export Preview</div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-green-600 transition-opacity duration-300">
            {copyMessage}
          </span>
          <button
            onClick={handleCopyToClipboard}
            className="border px-3 py-2 rounded-2xl shadow-sm hover:shadow bg-slate-600 text-white"
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
      <textarea
        ref={exportTextRef}
        className="w-full min-h-[520px] border rounded-xl p-2 text-xs font-mono"
        readOnly
        value={exportText}
      />
      <div className="flex justify-end mt-2">
        <button
          onClick={downloadTxt}
          className="border px-3 py-2 rounded-2xl shadow-sm hover:shadow bg-indigo-600 text-white"
        >
          Download File
        </button>
      </div>
    </div>
  );
};

export default ExportPanel;