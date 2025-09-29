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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

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

type View = 'list' | 'timeline';
type TimelineCategory = 'Overdue' | 'Today' | 'This Week' | 'This Month' | 'Future';


// --- UTILITY FUNCTIONS ---
const formatTime = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map(v => v.toString().padStart(2, '0'))
    .join(':');
};

const getTimelineCategory = (deadline: string): TimelineCategory => {
    const taskDate = new Date(deadline);
    const today = new Date();
    // Normalize dates to prevent time-of-day issues
    taskDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    if (taskDate < today) return 'Overdue';
    if (taskDate.getTime() === today.getTime()) return 'Today';

    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + (6 - today.getDay())); // Get upcoming Sunday
    if (taskDate <= endOfWeek) return 'This Week';

    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if (taskDate <= endOfMonth) return 'This Month';
    
    return 'Future';
};


// --- REACT COMPONENTS ---
const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<View>('list');
  const [timedTaskId, setTimedTaskId] = useState<string | null>(null);
  const [isInIframe, setIsInIframe] = useState(false);

  // Refs for timer and file import
  const pipWindowRef = useRef<Window | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const isDistractedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if running in an iframe and alert the user
  useEffect(() => {
    if (window.top !== window) {
      setIsInIframe(true);
    }
  }, []);

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
  
  // Automatically sort tasks by impact/effort ratio for the list view
  const sortedTasks = useMemo(() => {
      return [...tasks].sort((a, b) => {
          const ratioA = a.effort > 0 ? a.impact / a.effort : a.impact;
          const ratioB = b.effort > 0 ? b.impact / b.effort : b.impact;
          return ratioB - ratioA; // Sort descending
      });
  }, [tasks]);

  // Group and sort tasks for the timeline view
  const timelineTasks = useMemo(() => {
    const grouped: Record<TimelineCategory, Task[]> = {
        Overdue: [],
        Today: [],
        'This Week': [],
        'This Month': [],
        Future: [],
    };
    tasks.forEach(task => {
        const category = getTimelineCategory(task.deadline);
        grouped[category].push(task);
    });
    // Sort tasks within each category
    for (const category in grouped) {
        grouped[category as TimelineCategory].sort((a, b) => {
             const ratioA = a.effort > 0 ? a.impact / a.effort : a.impact;
             const ratioB = b.effort > 0 ? b.impact / b.effort : b.impact;
             return ratioB - ratioA;
        });
    }
    return grouped;
  }, [tasks]);


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

  const handleStartTimer = async (taskId: string) => {
    if (timedTaskId) {
        alert("Another timer is already running. Please stop it first.");
        return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (!('documentPictureInPicture' in window)) {
        alert('Picture-in-Picture is not supported by your browser.');
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

        // Now that the window is open, set the state to trigger the timer effect
        setTimedTaskId(taskId);

    } catch (error) {
        console.error("Failed to open PiP window:", error);
        let message = "Failed to open the timer window.";
        if (error instanceof DOMException && error.name === 'SecurityError') {
            message += "\n\nThis is likely due to browser security restrictions when running in an embedded window (like a code playground). Please try opening the app in its own browser tab to use this feature.";
        } else {
            message += "\n\nThis feature might not be supported by your browser or requires a direct user click.";
        }
        alert(message);
        setTimedTaskId(null);
    }
  };

  // Effect to manage the timer logic once the PiP window is open
  useEffect(() => {
      if (!timedTaskId || !pipWindowRef.current) {
          return;
      }
      
      const pipWindow = pipWindowRef.current;

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
  }, [timedTaskId, handleStopTimer]);
  
  const handleExport = () => {
    if (tasks.length === 0) {
        alert("No tasks to export.");
        return;
    }
    const jsonString = JSON.stringify(tasks, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tasks-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result;
            if (typeof text !== 'string') {
                throw new Error("File could not be read.");
            }
            const importedTasks = JSON.parse(text);
            // Basic validation
            if (Array.isArray(importedTasks) && (importedTasks.length === 0 || importedTasks[0].id)) {
                 if (confirm("This will replace all current tasks. Are you sure?")) {
                    setTasks(importedTasks);
                 }
            } else {
                throw new Error("Invalid task file format.");
            }
        } catch (error) {
            console.error("Failed to import tasks:", error);
            alert(`Failed to import tasks. Please make sure it's a valid JSON file. Error: ${error.message}`);
        } finally {
            // Reset file input value to allow re-uploading the same file
            if(fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };
    reader.readAsText(file);
  };


  return (
    <div className="container">
      {isInIframe && (
        <div className="iframe-warning">
            <p><strong>Note:</strong> The Picture-in-Picture timer may not work in this embedded view. For full functionality, please open the app in a new tab.</p>
        </div>
      )}
      <header className="header">
        <h1>Productivity Hub</h1>
        <div className="view-toggle">
          <span>List</span>
          <label className="switch">
            <input type="checkbox" checked={view === 'timeline'} onChange={() => setView(v => v === 'list' ? 'timeline' : 'list')} />
            <span className="slider"></span>
          </label>
          <span>Timeline</span>
        </div>
      </header>

      <TaskForm onSubmit={addTask} />
      
      <div className="task-controls">
        <button className="btn" onClick={handleImportClick}>Import Tasks</button>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" style={{ display: 'none' }} />
        <button className="btn" onClick={handleExport}>Export Tasks</button>
      </div>

      {view === 'list' ? (
        <div className="task-list">
            {sortedTasks.map(task => (
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
        <div className="timeline-board">
          {(['Overdue', 'Today', 'This Week', 'This Month', 'Future'] as const).map(category => (
            <div key={category} className="timeline-column">
                <h2>{category}</h2>
                <div className="timeline-cards">
                    {timelineTasks[category].map(task => (
                        <div key={task.id} className="timeline-card">
                            <h4>{task.name}</h4>
                             <div className="task-meta-timeline">
                                <span>I: {task.impact}</span>
                                <span>E: {task.effort}</span>
                            </div>
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