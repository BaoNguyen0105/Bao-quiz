const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 2. TELL EXPRESS TO SERVE YOUR FRONTEND FILES 
// This line fixes the "Cannot GET /" error instantly!
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for processing file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// Initialize MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT || 3306,            
    user: process.env.MYSQLUSER,          
    password: process.env.MYSQLPASSWORD,            
    database: process.env.MYSQLDATABASE,
    waitForConnections: true,
    connectionLimit: 5,   // Keep it around 5 to stay safely under Aiven's free connection cap
    queueLimit: 0
});
console.log('MySQL Connection Pool established successfully.');

// Serve static assets (for local quiz images in the future)
app.use('/images', express.static(path.join(__dirname, 'images')));

// --- CORE API ROUTES ---

// 1. Fetch all quizzes for the Main Page
app.get('/api/quizzes', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, title, created_at FROM Quiz ORDER BY created_at DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Database error fetching quizzes.', details: error.message });
    }
});

// 2. Fetch a single quiz structure (Hides correct_option_id for security)
app.get('/api/quiz/:id', async (req, res) => {
    const quizId = req.params.id;
    try {
        const [quizzes] = await pool.query('SELECT title FROM Quiz WHERE id = ?', [quizId]);
        if (quizzes.length === 0) return res.status(404).json({ error: 'Quiz not found' });

        const [questions] = await pool.query('SELECT id, question_text FROM Question WHERE quiz_id = ?', [quizId]);

        for (let q of questions) {
            const [options] = await pool.query('SELECT id, option_text FROM `Option` WHERE question_id = ?', [q.id]);
            const [images] = await pool.query('SELECT image_url FROM Q_IMAGE WHERE question_id = ?', [q.id]);
            
            q.options = options;
            q.images = images.map(img => img.image_url);
        }

        res.json({ quiz_id: quizId, title: quizzes[0].title, questions });
    } catch (error) {
        res.status(500).json({ error: 'Database error assembling quiz execution frame.', details: error.message });
    }
});

// 3. Check an answer instantly (Per-Question Mode)
app.get('/api/question/:id/check', async (req, res) => {
    const questionId = req.params.id;
    const { selected_option_id } = req.query;

    try {
        const [questions] = await pool.query('SELECT correct_option_id FROM Question WHERE id = ?', [questionId]);
        if (questions.length === 0) return res.status(404).json({ error: 'Question not found' });

        const correctOptionId = questions[0].correct_option_id;
        res.json({
            question_id: parseInt(questionId),
            is_correct: correctOptionId === parseInt(selected_option_id),
            correct_option_id: correctOptionId
        });
    } catch (error) {
        res.status(500).json({ error: 'Evaluation engine failure.', details: error.message });
    }
});

// 4. Evaluate an entire quiz at once (End-of-Quiz Mode)
app.post('/api/quiz/:id/submit', async (req, res) => {
    const quizId = req.params.id;
    const { answers } = req.body; // Expects an array: [{ question_id, selected_option_id }]

    try {
        const [questions] = await pool.query('SELECT id, correct_option_id FROM Question WHERE quiz_id = ?', [quizId]);
        const correctMap = {};
        questions.forEach(q => correctMap[q.id] = q.correct_option_id);

        let score = 0;
        const breakdown = {};

        answers.forEach(ans => {
            if (correctMap[ans.question_id] !== undefined) {
                const isCorrect = correctMap[ans.id] === ans.selected_option_id;
                if (isCorrect) score++;
                breakdown[ans.question_id] = {
                    is_correct: isCorrect,
                    correct_option_id: correctMap[ans.question_id]
                };
            }
        });

        res.json({ score, total_questions: questions.length, breakdown });
    } catch (error) {
        res.status(500).json({ error: 'Bulk evaluation mapping failed.', details: error.message });
    }
});

// 5. Delete a quiz
app.delete('/api/quiz/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM Quiz WHERE id = ?', [req.params.id]);
        res.json({ message: 'Quiz deleted successfully (cascading completed).' });
    } catch (error) {
        res.status(500).json({ error: 'Deletion dependency failure.', details: error.message });
    }
});

// --- BULK PARSING & ATOMIC DATA INGESTION ENGINE ---

// Helper function to execute the multi-step transaction for a parsed question object
async function insertParsedQuestion(connection, quizId, questionData) {
    // 1. Insert question stem without correct answer reference
    const [qResult] = await connection.query(
        'INSERT INTO Question (quiz_id, question_text, correct_option_id) VALUES (?, ?, NULL)',
        [quizId, questionData.question_text]
    );
    const questionId = qResult.insertId;

    // 2. Loop through options and track database mapping IDs
    let correctOptionDbId = null;
    for (let optText of questionData.options) {
        const [optResult] = await connection.query(
            'INSERT INTO `Option` (question_id, option_text) VALUES (?, ?)',
            [questionId, optText]
        );
        // Identify if this newly created option matches what the file marked as correct
        if (optText.trim() === questionData.correct_option.trim()) {
            correctOptionDbId = optResult.insertId;
        }
    }

    // 3. Establish structural integrity link
    if (correctOptionDbId) {
        await connection.query(
            'UPDATE Question SET correct_option_id = ? WHERE id = ?',
            [correctOptionDbId, questionId]
        );
    }

    // 4. Track local optional image associations if present
    if (questionData.images && Array.isArray(questionData.images)) {
        for (let imgPath of questionData.images) {
            await connection.query(
                'INSERT INTO Q_IMAGE (question_id, image_url) VALUES (?, ?)',
                [questionId, imgPath]
            );
        }
    }
}

// 6. Upload API for JSON or CSV quiz population
app.post('/api/quiz/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No data payload file attached.' });
    
    const quizTitle = req.body.title || 'Imported Quiz File';
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let parsedQuestions = [];

    try {
        const fileContent = req.file.buffer.toString('utf-8');

        if (fileExtension === '.json') {
            parsedQuestions = JSON.parse(fileContent);
        } else if (fileExtension === '.csv') {
            const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');
            
            // Start loop at 1 to skip header row
            for (let i = 1; i < lines.length; i++) {
                const columns = lines[i].split(',');
                if (columns.length < 4) continue; // Requires text, correct answer, image column, and at least one option

                // Clean up quotes and trailing white spaces per column string
                const questionText = columns[0].replace(/^"|"$/g, '').trim();
                const correctOption = columns[1].replace(/^"|"$/g, '').trim();
                const imagePath = columns[2].replace(/^"|"$/g, '').trim();
                
                // Extract all choices from column index 3 to the end of the row
                const options = columns.slice(3)
                                       .map(opt => opt.replace(/^"|"$/g, '').trim())
                                       .filter(opt => opt !== '');

                // Array to feed down to the database transaction handler
                const imagesArray = imagePath ? [imagePath] : [];

                parsedQuestions.push({
                    question_text: questionText,
                    correct_option: correctOption,
                    options: options,
                    images: imagesArray
                });
            }
        } else {
            return res.status(400).json({ error: 'Unsupported file extension format type.' });
        }
    } catch (parseErr) {
        return res.status(400).json({ error: 'Format standard parsing violation.', details: parseErr.message });
    }

    // --- ATOMIC DATABASE TRANSACTION INGESTION ---
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [quizResult] = await connection.query('INSERT INTO Quiz (title) VALUES (?)', [quizTitle]);
        const quizId = quizResult.insertId;

        for (let questionData of parsedQuestions) {
            await insertParsedQuestion(connection, quizId, questionData);
        }

        await connection.commit();
        res.status(201).json({ message: 'Quiz uploaded successfully', quiz_id: quizId, questions_count: parsedQuestions.length });
    } catch (transactionError) {
        await connection.rollback();
        res.status(500).json({ error: 'Transaction failed. Changes rolled back.', details: transactionError.message });
    } finally {
        connection.release();
    }
});

// Start listening execution
const PORT = 3000;
app.listen(PORT, () => console.log(`Running`));