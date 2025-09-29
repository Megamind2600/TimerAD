/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Fix: Add type definitions for the experimental Document Picture-in-Picture API to resolve TypeScript compilation error.
declare global {
  interface Window {
    documentPictureInPicture: {
      requestWindow(options?: {
        width: number;
        height: number;
      }): Promise<Window>;
    };
  }
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- TYPES AND INTERFACES ---
type Task = {
  id: string;
  name: string;
  impact: number;
  effort: number;
  deadline: string;
  status: 'todo' | 'inprogress' | 'done';
  timeSpent: number; // in seconds
  distractionTime: number; // in seconds
};

type View = 'list' | 'kanban';

// --- CONSTANTS ---
const API_KEY = process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: API_KEY });
const GEMINI_MODEL = 'gemini-2.5-flash';

const taskSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    name: { type: Type.STRING },
    impact: { type: Type.NUMBER },
    effort: { type: Type.NUMBER },
    deadline: { type: Type.STRING },
    status: { type: Type.STRING },
    timeSpent: { type: Type.NUMBER },
    distractionTime: { type: Type.NUMBER },
  },
};

const priorityResponseSchema = {
  type: Type.ARRAY,
  items: taskSchema,
};

// --- UTILITY FUNCTIONS ---
const formatTime = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map(v => v.toString().padStart(2, '0'))
    .join(':');
};

// --- REACT COMPONENTS ---

const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<View>('list');
  const [isLoading, setIsLoading] = useState(false);
  const [timedTaskId, setTimedTaskId] = useState<string | null>(null);

  // Refs for timer management
  const pipWindowRef = useRef<Window | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const isDistractedRef = useRef(false);

  // Load tasks from localStorage on initial render
  useEffect(() => {
    try {
      const savedTasks = localStorage.getItem('tasks');
      if (savedTasks) {
        setTasks(JSON.parse(savedTasks));
      }
    } catch (error) {
      console.error("Failed to load tasks from localStorage", error);
    }
  }, []);

  // Save tasks to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('tasks', JSON.stringify(tasks));
    } catch (error) {
      console.error("Failed to save tasks to localStorage", error);
    }
  }, [tasks]);

  const addTask = (task: Omit<Task, 'id' | 'status' | 'timeSpent' | 'distractionTime'>) => {
    const newTask: Task = {
      ...task,
      id: `task-${Date.now()}`,
      status: 'todo',
      timeSpent: 0,
      distractionTime: 0,
    };
    setTasks(prevTasks => [...prevTasks, newTask]);
  };

  const updateTask = (updatedTask: Task) => {
    setTasks(prevTasks =>
      prevTasks.map(task => (task.id === updatedTask.id ? updatedTask : task))
    );
  };
  
  const handlePrioritize = async () => {
    setIsLoading(true);
    try {
        const prompt = `Based on this list of tasks, prioritize them for me. Consider the impact (higher is better), effort (lower is better), and how soon the deadline is. Return a JSON array of the task objects, sorted by priority. The tasks are: ${JSON.stringify(tasks.filter(t => t.status !== 'done'))}`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: priorityResponseSchema,
            },
        });
        
        const prioritizedTasks = JSON.parse(response.text);
        const doneTasks = tasks.filter(t => t.status === 'done');
        setTasks([...prioritizedTasks, ...doneTasks]);

    } catch (error) {
        console.error("Error prioritizing tasks with Gemini:", error);
        alert("Failed to prioritize tasks. Please check your API key and try again.");
    } finally {
        setIsLoading(false);
    }
  };

  const handleStartTimer = (taskId: string) => {
    if (timedTaskId) {
        alert("Another timer is already running. Please stop it first.");
        return;
    }
    setTimedTaskId(taskId);
  };

  const handleStopTimer = useCallback(() => {
      if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
      }
      if (pipWindowRef.current) {
          pipWindowRef.current.close();
          pipWindowRef.current = null;
      }
      setTimedTaskId(null);
  }, []);

  // Effect to manage the Picture-in-Picture timer window and logic
  useEffect(() => {
      if (!timedTaskId) {
          return;
      }

      const task = tasks.find(t => t.id === timedTaskId);
      if (!task) return;

      const openPipWindow = async () => {
          if (!('documentPictureInPicture' in window)) {
              alert('Picture-in-Picture is not supported by your browser.');
              setTimedTaskId(null);
              return;
          }

          try {
              const pipWindow = await window.documentPictureInPicture.requestWindow({
                  width: 300,
                  height: 150,
              });
              pipWindowRef.current = pipWindow;
              
              const timerWidgetStyle = `
                  :root { --primary-color: #007bff; --warning-background: #4d3a05; --font-family: 'Inter', sans-serif;}
                  body { margin: 0; font-family: var(--font-family); color: white; background-color: var(--primary-color); display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; transition: background-color 0.5s; }
                  body.distraction { background-color: var(--warning-background); }
                  .content { padding: 1rem; }
                  h1 { font-size: 2rem; margin: 0; font-weight: 700; }
                  p { font-size: 1rem; margin: 0; opacity: 0.8; }
              `;
              const styleSheet = new CSSStyleSheet();
              styleSheet.replaceSync(timerWidgetStyle);
              pipWindow.document.adoptedStyleSheets = [styleSheet];
              
              pipWindow.document.body.innerHTML = `
                  <div class="content">
                      <p id="task-name">${task.name}</p>
                      <h1 id="timer-display">${formatTime(task.timeSpent)}</h1>
                      <p id="distraction-label" style="display: none;">Distraction: <span id="distraction-time">00:00:00</span></p>
                  </div>`;

              pipWindow.addEventListener('pagehide', () => {
                  handleStopTimer();
              });

              // Start the timer interval
              timerIntervalRef.current = window.setInterval(() => {
                  setTasks(currentTasks => 
                      currentTasks.map(t => {
                          if (t.id === timedTaskId) {
                              const newTimeSpent = isDistractedRef.current ? t.timeSpent : t.timeSpent + 1;
                              const newDistractionTime = isDistractedRef.current ? t.distractionTime + 1 : t.distractionTime;
                              
                              const timerDisplay = pipWindow.document.getElementById('timer-display');
                              if (timerDisplay) timerDisplay.textContent = formatTime(newTimeSpent);

                              const distractionLabel = pipWindow.document.getElementById('distraction-label');
                              const distractionTime = pipWindow.document.getElementById('distraction-time');
                              if (distractionLabel && distractionTime) {
                                distractionLabel.style.display = newDistractionTime > 0 ? 'block' : 'none';
                                distractionTime.textContent = formatTime(newDistractionTime);
                              }

                              return { ...t, timeSpent: newTimeSpent, distractionTime: newDistractionTime };
                          }
                          return t;
                      })
                  );
              }, 1000);

          } catch (error) {
              console.error("Failed to open PiP window:", error);
              setTimedTaskId(null);
          }
      };
      
      openPipWindow();
      
      const handleVisibilityChange = () => {
          isDistractedRef.current = document.visibilityState === 'hidden';
          if (pipWindowRef.current) {
              pipWindowRef.current.document.body.classList.toggle('distraction', isDistractedRef.current);
          }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          handleStopTimer();
      };
  }, [timedTaskId, handleStopTimer, tasks]);

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("taskId", taskId);
  };

  const onDrop = (e: React.DragEvent, newStatus: Task['status']) => {
    const taskId = e.dataTransfer.getData("taskId");
    const draggedTask = tasks.find(t => t.id === taskId);
    if (draggedTask) {
        updateTask({ ...draggedTask, status: newStatus });
    }
    e.currentTarget.classList.remove('drag-over');
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Productivity Hub</h1>
        <div className="view-toggle">
          <span>List</span>
          <label className="switch">
            <input type="checkbox" checked={view === 'kanban'} onChange={() => setView(v => v === 'list' ? 'kanban' : 'list')} />
            <span className="slider"></span>
          </label>
          <span>Kanban</span>
        </div>
      </header>

      <TaskForm onSubmit={addTask} />
      
      <div className="task-controls">
        <button className="btn btn-primary" onClick={handlePrioritize} disabled={isLoading}>
            {isLoading ? <div className="loader-container"><div className="loader"></div><span>Prioritizing...</span></div> : 'Prioritize with AI'}
        </button>
      </div>

      {view === 'list' ? (
        <div className="task-list">
            {tasks.map(task => (
                <div key={task.id} className="task-item">
                    <div className="task-details">
                        <h3>{task.name}</h3>
                        <div className="task-meta">
                            <span>Impact: {task.impact}</span>
                            <span>Effort: {task.effort}</span>
                            <span>Deadline: {task.deadline}</span>
                            <span>Status: {task.status}</span>
                            <span>Time Spent: {formatTime(task.timeSpent)}</span>
                            <span>Distraction: {formatTime(task.distractionTime)}</span>
                        </div>
                    </div>
                    <div className="task-actions">
                        <button className="btn btn-timer" onClick={() => handleStartTimer(task.id)}>Start Timer</button>
                    </div>
                </div>
            ))}
        </div>
      ) : (
        <div className="kanban-board">
          {(['todo', 'inprogress', 'done'] as const).map(status => (
            <div key={status} className="kanban-column">
                <h2>{status.charAt(0).toUpperCase() + status.slice(1)}</h2>
                <div 
                    className="kanban-cards"
                    onDrop={(e) => onDrop(e, status)}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                >
                    {tasks.filter(t => t.status === status).map(task => (
                        <div key={task.id} className="kanban-card" draggable onDragStart={(e) => onDragStart(e, task.id)}>
                            <h4>{task.name}</h4>
                            <p>Deadline: {task.deadline}</p>
                        </div>
                    ))}
                </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


const TaskForm: React.FC<{ onSubmit: (data: Omit<Task, 'id' | 'status' | 'timeSpent' | 'distractionTime'>) => void }> = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [impact, setImpact] = useState(5);
  const [effort, setEffort] = useState(5);
  const [deadline, setDeadline] = useState(new Date().toISOString().split('T')[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name, impact, effort, deadline });
    setName('');
  };

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <h2>Add New Task</h2>
      <div className="form-group">
        <label htmlFor="name">Task Name</label>
        <input type="text" id="name" value={name} onChange={e => setName(e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="impact">Impact: {impact}</label>
        <div className="slider-group">
            <span>1</span>
            <input type="range" id="impact" min="1" max="10" value={impact} onChange={e => setImpact(Number(e.target.value))} />
            <span>10</span>
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="effort">Effort: {effort}</label>
        <div className="slider-group">
            <span>1</span>
            <input type="range" id="effort" min="1" max="10" value={effort} onChange={e => setEffort(Number(e.target.value))} />
            <span>10</span>
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="deadline">Deadline</label>
        <input type="date" id="deadline" value={deadline} onChange={e => setDeadline(e.target.value)} required />
      </div>
      <button type="submit" className="btn btn-primary">Add Task</button>
    </form>
  );
};


const root = createRoot(document.getElementById('root')!);
root.render(<App />);