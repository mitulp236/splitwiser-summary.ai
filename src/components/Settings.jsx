import React, { useState, useEffect } from 'react'

const Settings = () => {
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const storedKey = localStorage.getItem('OPENAI_API_KEY')
    if (storedKey) setApiKey(storedKey)
  }, [])

  const handleSave = () => {
    localStorage.setItem('OPENAI_API_KEY', apiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
      </div>
      <div>
        <label className="block mb-2 text-sm font-medium text-gray-700">OpenAI API Key</label>
        <input
          type="text"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
          placeholder="Enter your OpenAI API Key"
        />
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition"
        >
          Save
        </button>
        {saved && <div className="mt-4 text-green-600 text-center text-sm">✅ API Key saved!</div>}
      </div>
    </div>
  )
}

export default Settings
