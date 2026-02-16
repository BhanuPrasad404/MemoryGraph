// routes/graph.js - SIMPLIFIED FOR MVP
const express = require('express');
const router = express.Router();
const memoryGraph = require('../services/memoryGraph');
const supabaseService = require('../services/supabaseService');

// 1. Document graph (USER) - Most important!
router.get('/document/:documentId', async (req, res) => {
    const { documentId } = req.params;
    const userId = req.user?.id  // From auth later

    const document = await supabaseService.getDocument(documentId);
    if (!document || document.user_id !== userId) {
        return res.status(404).json({ error: 'Not found' });
    }

    const graph = await memoryGraph.getDocumentGraph(documentId);

    res.json({
        success: true,
        data: graph,
        document: {
            id: documentId,
            filename: document.filename
        }
    });
});

// 2. User's complete graph (USER) - Second most important!
router.get('/user', async (req, res) => {
    const userId = req.user?.id;

    const graph = await memoryGraph.getUserGraph(userId);

    res.json({
        success: true,
        data: graph
    });
});

// 3. Graph search (Optional - nice to have)
router.get('/search', async (req, res) => {
    const { q: query } = req.query;
    const userId = req.user?.id;

    if (!query) {
        return res.status(400).json({ error: 'Query required' });
    }

    const result = await memoryGraph.findRelatedConcepts(query, userId);

    res.json({
        success: true,
        query: query,
        data: result
    });
});

module.exports = router;