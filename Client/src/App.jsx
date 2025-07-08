import React, { useState, useEffect } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import './App.css';

const API_URL = 'http://localhost:5000/api';
const socket = io('http://localhost:5000');

function App() {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [actionLogs, setActionLogs] = useState([]);
  const [isLogin, setIsLogin] = useState(true);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictData, setConflictData] = useState(null);
  const [draggedTask, setDraggedTask] = useState(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [currentTask, setCurrentTask] = useState(null);
  const [showActivityLog, setShowActivityLog] = useState(false);

  // Auth form state
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  });

  // Task form state
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    assignedUser: '',
    priority: 'Medium'
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUserData();
      fetchTasks();
      fetchUsers();
      fetchActionLogs();
    }
  }, []);

  useEffect(() => {
    // Socket event listeners
    socket.on('taskCreated', (task) => {
      setTasks(prev => [...prev, task]);
    });

    socket.on('taskUpdated', (updatedTask) => {
      setTasks(prev => prev.map(task => 
        task._id === updatedTask._id ? updatedTask : task
      ));
    });

    socket.on('taskDeleted', (taskId) => {
      setTasks(prev => prev.filter(task => task._id !== taskId));
    });

    socket.on('actionLogged', (action) => {
      setActionLogs(prev => [action, ...prev].slice(0, 20));
    });

    return () => {
      socket.off('taskCreated');
      socket.off('taskUpdated');
      socket.off('taskDeleted');
      socket.off('actionLogged');
    };
  }, []);

  const fetchUserData = async () => {
    try {
      const token = localStorage.getItem('token');
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUser({ 
        id: payload.userId, 
        username: payload.username, 
        isAdmin: payload.isAdmin 
      });
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  const fetchTasks = async () => {
    try {
      const response = await axios.get(`${API_URL}/tasks`);
      setTasks(response.data);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await axios.get(`${API_URL}/users`);
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchActionLogs = async () => {
    try {
      const response = await axios.get(`${API_URL}/actions`);
      setActionLogs(response.data);
    } catch (error) {
      console.error('Error fetching action logs:', error);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const response = await axios.post(`${API_URL}${endpoint}`, formData);
      
      localStorage.setItem('token', response.data.token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
      
      setUser(response.data.user);
      fetchTasks();
      fetchUsers();
      fetchActionLogs();
      setFormData({ username: '', email: '', password: '' });
    } catch (error) {
      alert(error.response?.data?.error || 'Authentication failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
    setTasks([]);
    setUsers([]);
    setActionLogs([]);
  };

  const handleTaskSubmit = async (e) => {
    e.preventDefault();
    try {
      if (currentTask) {
        await axios.put(`${API_URL}/tasks/${currentTask._id}`, {
          ...taskForm,
          version: currentTask.version
        });
      } else {
        await axios.post(`${API_URL}/tasks`, taskForm);
      }
      setShowTaskModal(false);
      setCurrentTask(null);
      setTaskForm({ title: '', description: '', assignedUser: '', priority: 'Medium' });
    } catch (error) {
      if (error.response?.status === 409) {
        setConflictData({
          currentTask: error.response.data.currentTask,
          userChanges: taskForm
        });
        setShowConflictModal(true);
      } else {
        alert(error.response?.data?.error || 'Error saving task');
      }
    }
  };

  const handleDragStart = (e, task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, newStatus) => {
    e.preventDefault();
    if (draggedTask && draggedTask.status !== newStatus) {
      try {
        await axios.put(`${API_URL}/tasks/${draggedTask._id}`, {
          ...draggedTask,
          status: newStatus,
          version: draggedTask.version
        });
      } catch (error) {
        if (error.response?.status === 409) {
          setConflictData({
            currentTask: error.response.data.currentTask,
            userChanges: { ...draggedTask, status: newStatus }
          });
          setShowConflictModal(true);
        } else {
          alert(error.response?.data?.error || 'Error updating task');
        }
      }
    }
    setDraggedTask(null);
  };

  const handleSmartAssign = async (taskId) => {
    try {
      await axios.post(`${API_URL}/tasks/${taskId}/smart-assign`);
    } catch (error) {
      alert(error.response?.data?.error || 'Error assigning task');
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await axios.delete(`${API_URL}/tasks/${taskId}`);
      } catch (error) {
        alert(error.response?.data?.error || 'Error deleting task');
      }
    }
  };

  const handleConflictResolve = async (action) => {
    try {
      if (action === 'merge') {
        // Simple merge: keep current task data but update with user changes
        const mergedData = { ...conflictData.currentTask, ...conflictData.userChanges };
        await axios.put(`${API_URL}/tasks/${conflictData.currentTask._id}`, mergedData);
      } else if (action === 'overwrite') {
        // Overwrite: force update with user changes
        await axios.put(`${API_URL}/tasks/${conflictData.currentTask._id}`, {
          ...conflictData.userChanges,
          version: conflictData.currentTask.version
        });
      }
      setShowConflictModal(false);
      setConflictData(null);
    } catch (error) {
      alert(error.response?.data?.error || 'Error resolving conflict');
    }
  };

  const openTaskModal = (task = null) => {
    setCurrentTask(task);
    if (task) {
      setTaskForm({
        title: task.title,
        description: task.description,
        assignedUser: task.assignedUser._id,
        priority: task.priority
      });
    } else {
      setTaskForm({ title: '', description: '', assignedUser: '', priority: 'Medium' });
    }
    setShowTaskModal(true);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  // Check if user can edit task (admin or task owner)
  const canEditTask = (task) => {
    return user?.isAdmin || task.assignedUser._id === user?.id;
  };

  // Check if user can delete task (admin only)
  const canDeleteTask = () => {
    return user?.isAdmin;
  };

  // Check if user can create task (admin only)
  const canCreateTask = () => {
    return user?.isAdmin;
  };

  // Check if user can smart assign (admin only)
  const canSmartAssign = () => {
    return user?.isAdmin;
  };

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-form">
          <h2>{isLogin ? 'Login' : 'Register'}</h2>
          <form onSubmit={handleAuth}>
            {!isLogin && (
              <input
                type="text"
                placeholder="Username"
                value={formData.username}
                onChange={(e) => setFormData({...formData, username: e.target.value})}
                required
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={formData.password}
              onChange={(e) => setFormData({...formData, password: e.target.value})}
              required
            />
            <button type="submit">{isLogin ? 'Login' : 'Register'}</button>
          </form>
          <p>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              className="link-button"
              onClick={() => setIsLogin(!isLogin)}
            >
              {isLogin ? 'Register' : 'Login'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Task Management System</h1>
        <div className="header-actions">
          <span>
            Welcome, {user.username}
            {user.isAdmin && <span className="admin-badge">Admin</span>}
          </span>
          <button onClick={() => setShowActivityLog(!showActivityLog)}>
            {showActivityLog ? 'Hide' : 'Show'} Activity Log
          </button>
          {canCreateTask() && (
            <button onClick={() => openTaskModal()}>Add Task</button>
          )}
          <button onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="main-content">
        <div className="kanban-board">
          {['Todo', 'In Progress', 'Done'].map(status => (
            <div
              key={status}
              className="kanban-column"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, status)}
            >
              <h3>{status}</h3>
              <div className="tasks-container">
                {tasks
                  .filter(task => task.status === status)
                  .map(task => (
                    <div
                      key={task._id}
                      className={`task-card ${task.priority.toLowerCase()}`}
                      draggable={canEditTask(task)}
                      onDragStart={(e) => handleDragStart(e, task)}
                    >
                      <div className="task-header">
                        <h4>{task.title}</h4>
                        <div className="task-actions">
                          {canSmartAssign() && (
                            <button
                              className="smart-assign-btn"
                              onClick={() => handleSmartAssign(task._id)}
                              title="Smart Assign"
                            >
                              🎯
                            </button>
                          )}
                          {canEditTask(task) && (
                            <button
                              className="edit-btn"
                              onClick={() => openTaskModal(task)}
                              title="Edit Task"
                            >
                              ✏️
                            </button>
                          )}
                          {canDeleteTask() && (
                            <button
                              className="delete-btn"
                              onClick={() => handleDeleteTask(task._id)}
                              title="Delete Task"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="task-description">{task.description}</p>
                      <div className="task-meta">
                        <span className="assigned-user">
                          👤 {task.assignedUser.username}
                        </span>
                        <span className={`priority ${task.priority.toLowerCase()}`}>
                          {task.priority}
                        </span>
                      </div>
                      <div className="task-dates">
                        <small>Created: {formatDate(task.createdAt)}</small>
                        {task.updatedAt !== task.createdAt && (
                          <small>Updated: {formatDate(task.updatedAt)}</small>
                        )}
                      </div>
                      {!canEditTask(task) && (
                        <div className="task-permissions">
                          <small>👁️ View Only</small>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        {showActivityLog && (
          <div className="activity-log">
            <h3>Activity Log</h3>
            <div className="log-entries">
              {actionLogs.map(log => (
                <div key={log._id} className="log-entry">
                  <div className="log-header">
                    <span className="log-action">{log.action}</span>
                    <span className="log-timestamp">{formatDate(log.timestamp)}</span>
                  </div>
                  <div className="log-details">
                    <span className="log-user">{log.userId?.username || 'Unknown'}</span>
                    {log.details && <span className="log-description">{log.details}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Task Modal */}
      {showTaskModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{currentTask ? 'Edit Task' : 'Create New Task'}</h3>
              <button 
                className="modal-close"
                onClick={() => setShowTaskModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleTaskSubmit}>
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({...taskForm, title: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({...taskForm, description: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Assigned User</label>
                <select
                  value={taskForm.assignedUser}
                  onChange={(e) => setTaskForm({...taskForm, assignedUser: e.target.value})}
                  required
                >
                  <option value="">Select User</option>
                  {users.map(user => (
                    <option key={user._id} value={user._id}>
                      {user.username}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm({...taskForm, priority: e.target.value})}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowTaskModal(false)}>
                  Cancel
                </button>
                <button type="submit">
                  {currentTask ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Conflict Resolution Modal */}
      {showConflictModal && conflictData && (
        <div className="modal-overlay">
          <div className="modal conflict-modal">
            <div className="modal-header">
              <h3>Conflict Detected</h3>
              <button 
                className="modal-close"
                onClick={() => setShowConflictModal(false)}
              >
                ×
              </button>
            </div>
            <div className="conflict-content">
              <p>Another user has modified this task. Please resolve the conflict:</p>
              
              <div className="conflict-comparison">
                <div className="conflict-side">
                  <h4>Current Version</h4>
                  <div className="conflict-data">
                    <p><strong>Title:</strong> {conflictData.currentTask.title}</p>
                    <p><strong>Description:</strong> {conflictData.currentTask.description}</p>
                    <p><strong>Status:</strong> {conflictData.currentTask.status}</p>
                    <p><strong>Priority:</strong> {conflictData.currentTask.priority}</p>
                    <p><strong>Last Updated:</strong> {formatDate(conflictData.currentTask.updatedAt)}</p>
                  </div>
                </div>
                
                <div className="conflict-side">
                  <h4>Your Changes</h4>
                  <div className="conflict-data">
                    <p><strong>Title:</strong> {conflictData.userChanges.title}</p>
                    <p><strong>Description:</strong> {conflictData.userChanges.description}</p>
                    <p><strong>Status:</strong> {conflictData.userChanges.status}</p>
                    <p><strong>Priority:</strong> {conflictData.userChanges.priority}</p>
                  </div>
                </div>
              </div>
              
              <div className="conflict-actions">
                <button 
                  onClick={() => handleConflictResolve('merge')}
                  className="merge-btn"
                >
                  Merge Changes
                </button>
                <button 
                  onClick={() => handleConflictResolve('overwrite')}
                  className="overwrite-btn"
                >
                  Overwrite with My Changes
                </button>
                <button 
                  onClick={() => setShowConflictModal(false)}
                  className="cancel-btn"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;