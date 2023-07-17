import React, { useState } from "react";
// import { useMutation } from 'react-query';
// import axios from 'axios';

type FileInputEvent = React.ChangeEvent<HTMLInputElement>;

interface AppState {
  projectName: string;
  projectFiles: File[];
  error: string | null;
}

function App() {
  const [state, setState] = useState<AppState>({
    projectName: "",
    projectFiles: [],
    error: null
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setState((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: FileInputEvent) => {
    const files = Array.from(e.target.files || []).filter(file => file.type === "application/pdf");
    if (files.length > 5) {
      setState((prev) => ({ ...prev, error: "You can upload up to 5 files." }));
      return;
    }
    setState((prev) => ({ ...prev, projectFiles: files }));
  };

  /*
  const mutation = useMutation(async (data: AppState) => {
    const response = await axios.post('/api/projects', { name: data.projectName });
    const projectId = response.data.id;
    const formData = new FormData();
    data.projectFiles.forEach((file, index) => {
      formData.append(`file${index}`, file);
    });
    await axios.post(`/api/upload/${projectId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  }, {
    onError: (error) => {
      setState((prev) => ({ ...prev, error: error.message }));
    }
  });
  */

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { projectName, projectFiles } = state;
    if (!projectName || projectFiles.length === 0) {
      setState((prev) => ({
        ...prev,
        error: "Project name or files are missing."
      }));
      return;
    }

    // mutation.mutate(state);
  };

  return (
    <div className="p-4">
      <h1 className="text-4xl font-bold mb-4">Welcome to the Common Good Marketplace</h1>
      <h3 className="text-2xl mb-4">We're excited you're here! Please answer the following questions:</h3>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-white-700">What is your project's name?</span>
          <input type="text" name="projectName" onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50" />
        </label>
        <label className="block">
          <span className="text-white-700">Please upload any relevant documents that describe your impact (up to 5 files)</span>
          <input type="file" accept=".pdf" onChange={handleFileChange} multiple className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50" />
        </label>
        <button type="submit" className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
          Submit
        </button>
      </form>
      {state.error && <div className="text-red-500 mt-4">{state.error}</div>}
    </div>
  );
}

export default App;
