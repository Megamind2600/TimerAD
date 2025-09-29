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
  const [isDistracted, setIsDistracted] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  // Refs for timer and file import
  const pipWindowRef = useRef<Window | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if running in an iframe
  useEffect(() => {
    try {
        setIsInIframe(window.self !== window.top);
    } catch (e) {
        // Fallback for cross-origin iframes
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
  
  const sortedTasks = useMemo(() => {
      return [...tasks].sort((a, b) => {
          const ratioA = a.effort > 0 ? a.impact / a.effort : a.impact;
          const ratioB = b.effort > 0 ? b.impact / b.effort : b.impact;
          return ratioB - ratioA; // Sort descending
      });
  }, [tasks]);

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
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
          pipWindowRef.current.close();
      }
      pipWindowRef.current = null;
      setTimedTaskId(null);
  }, []);

  const renderWidgetContent = useCallback(() => {
    if (!pipWindowRef.current || pipWindowRef.current.closed) return;
    const pipDoc = pipWindowRef.current.document;
    pipDoc.body.innerHTML = ''; // Clear previous content

    if (timedTaskId) {
        // Render Timer View
        const task = tasks.find(t => t.id === timedTaskId);
        if (!task) return; // Should not happen
        pipDoc.body.innerHTML = `
            <div class="timer-view">
                <p id="task-name" title="${task.name}">${task.name}</p>
                <h1 id="timer-display">${formatTime(task.timeSpent)}</h1>
                <p class="distraction-label" id="distraction-label" style="display: none;">Distraction: <span id="distraction-time">00:00:00</span></p>
            </div>`;
    } else {
        // Render Task List View
        const topTasks = sortedTasks.slice(0, 3);
        const listContainer = pipDoc.createElement('div');
        listContainer.className = 'task-list';
        
        const title = pipDoc.createElement('h2');
        title.textContent = 'Top 3 Tasks';
        pipDoc.body.appendChild(title);
        pipDoc.body.appendChild(listContainer);

        if (topTasks.length > 0) {
            topTasks.forEach(task => {
                const item = pipDoc.createElement('div');
                item.className = 'task-item';
                
                const nameSpan = pipDoc.createElement('span');
                nameSpan.textContent = task.name;
                nameSpan.title = task.name;
                
                const startButton = pipDoc.createElement('button');
                startButton.textContent = 'Start';
                startButton.onclick = () => {
                    setTimedTaskId(task.id);
                };
                
                item.appendChild(nameSpan);
                item.appendChild(startButton);
                listContainer.appendChild(item);
            });
        } else {
            listContainer.innerHTML = '<p class="no-tasks">No tasks to show.</p>';
        }
    }
  }, [timedTaskId, tasks, sortedTasks, setTimedTaskId]);


  useEffect(() => {
      // Re-render widget content when timer starts/stops
      renderWidgetContent();
  }, [timedTaskId, renderWidgetContent]);


  const handleOpenWidget = async () => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.focus();
        return;
    }
    if (timedTaskId) {
        setWidgetError("A timer is already active. Please stop it before opening a new widget.");
        return;
    }

    if (!('documentPictureInPicture' in window)) {
        setWidgetError("Your browser does not support the Picture-in-Picture API required for the focus widget.");
        return;
    }
    
    setWidgetError(null); // Clear previous errors

    try {
        const pipWindow = await window.documentPictureInPicture.requestWindow({
            width: 320,
            height: 200,
        });
        pipWindowRef.current = pipWindow;
        
        const style = `
            :root { --primary-color: #007bff; --surface-color: #383838; --background-color: #2c2c2c; --warning-background: #4d3a05; --font-family: 'Inter', sans-serif; --text-color: #e0e0e0; }
            body { margin: 0; font-family: var(--font-family); color: var(--text-color); background-color: var(--background-color); padding: 1rem; height: 100vh; box-sizing: border-box; transition: background-color 0.5s; }
            body.distraction { background-color: var(--warning-background); }
            h2 { font-size: 1rem; margin: 0 0 1rem 0; text-align: center; }
            .task-list { display: flex; flex-direction: column; gap: 0.5rem; }
            .task-item { background-color: var(--surface-color); padding: 0.5rem; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
            .task-item span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 0.5rem; }
            .task-item button { padding: 0.25rem 0.5rem; border: none; border-radius: 4px; background-color: #28a745; color: white; cursor: pointer; flex-shrink: 0; }
            .timer-view { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; text-align: center; }
            #task-name { font-size: 0.9rem; margin: 0; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
            .timer-view h1 { font-size: 2.2rem; margin: 0.25rem 0; font-weight: 700; }
            .distraction-label { font-size: 0.8rem; }
            .no-tasks { text-align: center; font-size: 0.9rem; opacity: 0.8; padding-top: 1rem; }
        `;
        const styleSheet = new CSSStyleSheet();
        styleSheet.replaceSync(style);
        pipWindow.document.adoptedStyleSheets = [styleSheet];

        pipWindow.addEventListener('pagehide', () => {
            handleStopTimer();
        });

        renderWidgetContent();
        setIsDistracted(document.visibilityState === 'hidden');

    } catch (error) {
        console.error("Failed to open PiP window:", error);
        setWidgetError("Could not open focus widget. This feature may be blocked by your browser or another widget may be open.");
    }
  };


  useEffect(() => {
    if (!timedTaskId) return;

    // This effect starts/stops the master timer interval
    timerIntervalRef.current = window.setInterval(() => {
      setTasks(currentTasks =>
        currentTasks.map(t => {
          if (t.id === timedTaskId) {
            const newTimeSpent = isDistracted ? t.timeSpent : t.timeSpent + 1;
            const newDistractionTime = isDistracted ? t.distractionTime + 1 : t.distractionTime;

            if (pipWindowRef.current && !pipWindowRef.current.closed) {
              const timerDisplay = pipWindowRef.current.document.getElementById('timer-display');
              if (timerDisplay) timerDisplay.textContent = formatTime(newTimeSpent);

              const distractionLabel = pipWindowRef.current.document.getElementById('distraction-label');
              const distractionTimeEl = pipWindowRef.current.document.getElementById('distraction-time');
              if (distractionLabel && distractionTimeEl) {
                distractionLabel.style.display = newDistractionTime > 0 ? 'block' : 'none';
                distractionTimeEl.textContent = formatTime(newDistractionTime);
              }
            }
            return { ...t, timeSpent: newTimeSpent, distractionTime: newDistractionTime };
          }
          return t;
        })
      );
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [timedTaskId, isDistracted]);

  useEffect(() => {
    // This effect handles distraction tracking
    const handleVisibilityChange = () => {
      const distracted = document.visibilityState === 'hidden';
      setIsDistracted(distracted);
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.document.body.classList.toggle('distraction', distracted);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Also check if PiP window was closed manually
    const checkPipClosedInterval = setInterval(() => {
      if (pipWindowRef.current && pipWindowRef.current.closed) {
        handleStopTimer();
      }
    }, 500);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(checkPipClosedInterval);
    };
  }, [handleStopTimer]);

  
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
            if(fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };
    reader.readAsText(file);
  };

  if (isInIframe) {
    return (
      <div className="launcher-container">
        <div className="launcher-box">
          <h1>Productivity Hub</h1>
          <p>For full functionality, including the Focus Widget, the app must run in its own tab.</p>
          <button className="btn btn-launch" onClick={() => window.open(window.location.href, '_blank')}>
            🚀 Launch in New Tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
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
      
      <div className="task-controls">
         <button className="btn btn-primary" onClick={handleOpenWidget}>Open Focus Widget</button>
      </div>
      {widgetError && <p className="error-message">{widgetError}</p>}


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
                             <div className="task-meta-timeline">
                                <span>Time: {formatTime(task.timeSpent)}</span>
                            </div>
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