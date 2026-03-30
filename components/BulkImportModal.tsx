
import React, { useState } from 'react';
import { GoogleGenAI, Type, Schema } from "@google/genai";
import Modal from './Modal';
import { Loader2, Sparkles, FileText, CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: any[]) => Promise<void>;
  type: 'revenue' | 'project' | 'expense';
  schemaDescription: string;
}

const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, onClose, onImport, type, schemaDescription }) => {
  const [inputText, setInputText] = useState('');
  const [parsedData, setParsedData] = useState<any[] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getResponseSchema = (importType: string): Schema => {
    if (importType === 'project') {
      return {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            project_name: { type: Type.STRING },
            client_name: { type: Type.STRING },
            project_value: { type: Type.NUMBER },
            project_description: { type: Type.STRING },
            stream: { type: Type.STRING, description: "Income stream name hint" }
          },
          required: ['date', 'project_name', 'project_value']
        }
      };
    }
    if (importType === 'revenue') {
      return {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            client_name: { type: Type.STRING },
            project_description: { type: Type.STRING },
            total_sale: { type: Type.NUMBER },
            platform_fee_percent: { type: Type.NUMBER },
            stream: { type: Type.STRING, description: "Income stream name hint" }
          },
          required: ['date', 'client_name', 'total_sale']
        }
      };
    }
    if (importType === 'expense') {
       return {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            description: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            category: { type: Type.STRING },
            stream: { type: Type.STRING, description: "Income stream name hint for variable costs" }
          },
          required: ['date', 'description', 'amount', 'category']
        }
      };
    }
    return { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {} } };
  };

  const handleProcess = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        Extract ${type} records from the text below.
        Context: Today is ${new Date().toISOString().split('T')[0]}.
        Text: "${inputText}"
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: getResponseSchema(type)
        }
      });

      const text = response.text;
      if (!text) throw new Error("No data returned from AI");
      
      const result = JSON.parse(text);
      setParsedData(Array.isArray(result) ? result : [result]);
    } catch (err: any) {
      console.error(err);
      setError("AI parsing failed. Please try simpler formatting or check your API key.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = async () => {
    if (!parsedData) return;
    setIsSaving(true);
    setError(null); // Clear previous errors
    try {
      await onImport(parsedData);
      setParsedData(null);
      setInputText('');
      onClose();
    } catch (err: any) {
      console.error('Import Error:', err);
      // Capture detailed error message from Supabase or validation
      const msg = err.message || err.details || "Failed to save records. Check for missing fields or database constraints.";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const formatVal = (val: any) => {
    if (typeof val === 'number') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    return String(val);
  };

  return (
    <Modal 
      title={`Bulk AI Import: ${type.toUpperCase()}`} 
      isOpen={isOpen} 
      onClose={onClose}
      showSaveButton={false}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-6">
        {!parsedData ? (
          <div className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex gap-3">
              <Sparkles className="text-indigo-600 shrink-0" size={20} />
              <p className="text-xs font-medium text-indigo-700 leading-relaxed">
                Paste raw data from emails, CSVs, or chats. Our AI will automatically detect dates, clients, and amounts to map them to your fields.
              </p>
            </div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="e.g. 05/12 Client A paid $1200 for branding... 06/12 $500 from Client B..."
              className="w-full h-64 bg-gray-50 border border-gray-200 rounded-2xl p-6 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
            />
            <button
              onClick={handleProcess}
              disabled={isProcessing || !inputText.trim()}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 shadow-xl hover:bg-gray-800 disabled:opacity-50 transition-all"
            >
              {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              Process with Gemini AI
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Extracted Results ({parsedData.length})</h4>
              <button onClick={() => setParsedData(null)} className="text-xs font-bold text-rose-500 hover:underline">Clear & Re-paste</button>
            </div>
            
            <div className="border border-gray-100 rounded-[24px] overflow-hidden max-h-96 overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                  <tr>
                    {Object.keys(parsedData[0] || {}).map(k => <th key={k} className="px-6 py-4">{k.replace(/_/g, ' ')}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsedData.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-all">
                      {Object.values(item).map((v, j) => <td key={j} className="px-6 py-4 text-xs font-bold text-gray-700">{formatVal(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 flex items-start gap-3 text-rose-600 text-xs font-bold animate-in fade-in slide-in-from-top-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" /> 
                <span className="flex-1">{error}</span>
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={isSaving}
              className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 shadow-xl hover:bg-emerald-700 disabled:opacity-50 transition-all"
            >
              {isSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {isSaving ? 'Importing...' : 'Confirm & Import to Database'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default BulkImportModal;
