const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || process.env.FRONTEND_URL_SOCKET || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/collaborative-todo';
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema - Added isAdmin field
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false }, // Added isAdmin field
  createdAt: { type: Date, default: Date.now }
});

// Task Schema
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  assignedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['Todo', 'In Progress', 'Done'], default: 'Todo' },
  priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  version: { type: Number, default: 1 }
});

// Action Log Schema
const actionLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  details: { type: String },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);
const ActionLog = mongoose.model('ActionLog', actionLogSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Admin Check Middleware
const checkAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
};

// Check if user can edit task (admin or task owner)
const checkTaskEditPermission = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    const task = await Task.findById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Admin can edit any task, or user can edit their own assigned task
    if (user.isAdmin || task.assignedUser.toString() === req.user.userId) {
      req.task = task;
      next();
    } else {
      return res.status(403).json({ error: 'You can only edit tasks assigned to you or be an admin' });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
};

// Log Action Helper
const logAction = async (action, userId, taskId = null, details = '') => {
  try {
    const actionLog = new ActionLog({
      action,
      taskId,
      userId,
      details
    });
    await actionLog.save();
    
    // Emit to all connected clients
    const populatedLog = await ActionLog.findById(actionLog._id)
      .populate('userId', 'username')
      .populate('taskId', 'title');
    
    io.emit('actionLogged', populatedLog);
  } catch (error) {
    console.error('Error logging action:', error);
  }
};

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Routes

// User Registration - Updated to include isAdmin in token
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword,
      isAdmin: false // Default to false
    });

    await user.save();

    // Generate JWT token - Include isAdmin in token
    const token = jwt.sign(
      { userId: user._id, username: user.username, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// User Login - Updated to include isAdmin in token
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token - Include isAdmin in token
    const token = jwt.sign(
      { userId: user._id, username: user.username, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({}, 'username email isAdmin');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all tasks
app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const tasks = await Task.find({})
      .populate('assignedUser', 'username email')
      .populate('lastEditedBy', 'username')
      .sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create task - Only admin can create tasks
app.post('/api/tasks', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { title, description, assignedUser, priority } = req.body;

    // Validate unique title
    const existingTask = await Task.findOne({ title });
    if (existingTask) {
      return res.status(400).json({ error: 'Task title must be unique' });
    }

    // Validate title is not a column name
    const columnNames = ['Todo', 'In Progress', 'Done'];
    if (columnNames.includes(title)) {
      return res.status(400).json({ error: 'Task title cannot match column names' });
    }

    const task = new Task({
      title,
      description,
      assignedUser,
      priority,
      lastEditedBy: req.user.userId
    });

    await task.save();
    await task.populate('assignedUser', 'username email');

    // Log action
    await logAction('created', req.user.userId, task._id, `Created task "${title}"`);

    // Emit to all connected clients
    io.emit('taskCreated', task);

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update task - Admin can update any task, users can update their own assigned tasks
app.put('/api/tasks/:id', authenticateToken, checkTaskEditPermission, async (req, res) => {
  try {
    const { title, description, assignedUser, status, priority, version } = req.body;
    const taskId = req.params.id;
    const existingTask = req.task;

    // Check for conflicts
    if (version && existingTask.version !== version) {
      return res.status(409).json({ 
        error: 'Conflict detected',
        currentTask: existingTask,
        message: 'Another user has modified this task. Please resolve the conflict.'
      });
    }

    // Validate unique title if changed
    if (title && title !== existingTask.title) {
      const titleExists = await Task.findOne({ title, _id: { $ne: taskId } });
      if (titleExists) {
        return res.status(400).json({ error: 'Task title must be unique' });
      }

      const columnNames = ['Todo', 'In Progress', 'Done'];
      if (columnNames.includes(title)) {
        return res.status(400).json({ error: 'Task title cannot match column names' });
      }
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date(),
      lastEditedBy: req.user.userId,
      version: existingTask.version + 1
    };

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      updateData,
      { new: true }
    ).populate('assignedUser', 'username email');

    // Log action
    let actionDetails = '';
    if (status && status !== existingTask.status) {
      actionDetails = `Changed status from "${existingTask.status}" to "${status}"`;
    } else if (title && title !== existingTask.title) {
      actionDetails = `Updated task title to "${title}"`;
    } else {
      actionDetails = `Updated task "${existingTask.title}"`;
    }

    await logAction('updated', req.user.userId, taskId, actionDetails);

    // Emit to all connected clients
    io.emit('taskUpdated', updatedTask);

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete task - Only admin can delete tasks
app.delete('/api/tasks/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const taskId = req.params.id;
    const task = await Task.findById(taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await Task.findByIdAndDelete(taskId);

    // Log action
    await logAction('deleted', req.user.userId, taskId, `Deleted task "${task.title}"`);

    // Emit to all connected clients
    io.emit('taskDeleted', taskId);

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Smart assign task - Admin can smart assign any task
app.post('/api/tasks/:id/smart-assign', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const taskId = req.params.id;
    
    // Get all users
    const users = await User.find({});
    
    // Count active tasks per user
    const userTaskCounts = await Promise.all(
      users.map(async (user) => {
        const activeTaskCount = await Task.countDocuments({
          assignedUser: user._id,
          status: { $in: ['Todo', 'In Progress'] }
        });
        return { user: user._id, count: activeTaskCount };
      })
    );

    // Find user with minimum active tasks
    const minTaskUser = userTaskCounts.reduce((min, current) => 
      current.count < min.count ? current : min
    );

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { 
        assignedUser: minTaskUser.user,
        updatedAt: new Date(),
        lastEditedBy: req.user.userId,
        $inc: { version: 1 }
      },
      { new: true }
    ).populate('assignedUser', 'username email');

    // Log action
    await logAction('smart-assigned', req.user.userId, taskId, 
      `Smart assigned to ${updatedTask.assignedUser.username}`);

    // Emit to all connected clients
    io.emit('taskUpdated', updatedTask);

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get action logs
app.get('/api/actions', authenticateToken, async (req, res) => {
  try {
    const actions = await ActionLog.find({})
      .populate('userId', 'username')
      .populate('taskId', 'title')
      .sort({ timestamp: -1 })
      .limit(20);
    
    res.json(actions);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin route to update user admin status
app.put('/api/users/:id/admin', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { isAdmin } = req.body;
    const userId = req.params.id;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isAdmin },
      { new: true }
    ).select('-password');

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});