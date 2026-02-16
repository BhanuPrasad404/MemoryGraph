// services/memoryGraph.js
const aiService = require('./aiService');
const supabaseService = require('./supabaseService');
const logger = require('../utils/logger');

class MemoryGraph {
    constructor() {
        this.minEntityRelevance = 5; // 1-10 scale (lower threshold for more nodes)
        this.maxEntitiesPerChunk = 8;
        this.minCooccurrence = 2; // Minimum times entities appear together
        logger.info('🎯 MemoryGraph initialized - Ready to build knowledge graphs!');
    }

    /**
     * MAIN FUNCTION: Build knowledge graph from document chunks
     */
    async buildGraphFromChunks(chunks, documentId) {
        try {
            logger.info(`🏗️ Building graph for document ${documentId} (${chunks.length} chunks)`);

            if (!chunks || chunks.length === 0) {
                logger.warn('No chunks provided for graph building');
                return { nodes: [], edges: [] };
            }

            // STEP 1: Extract entities from ALL chunks
            logger.info('Step 1: Extracting entities from all chunks...');
            const allEntities = await this.extractEntitiesFromChunks(chunks);

            if (allEntities.length === 0) {
                logger.warn('No entities extracted from document');
                return { nodes: [], edges: [] };
            }

            logger.info(`✅ Extracted ${allEntities.length} unique entities`);

            // STEP 2: Create nodes in database
            logger.info('Step 2: Creating graph nodes...');
            const nodes = await this.createGraphNodes(allEntities, documentId);

            if (nodes.length === 0) {
                logger.warn('Failed to create graph nodes');
                return { nodes: [], edges: [] };
            }

            logger.info(`✅ Created ${nodes.length} graph nodes`);

            // STEP 3: Analyze relationships between entities
            logger.info('Step 3: Analyzing entity relationships...');
            const edges = await this.analyzeRelationships(chunks, nodes, documentId);

            logger.info(`✅ Created ${edges.length} relationship edges`);

            // STEP 4: Return graph data
            const graphData = {
                nodes: nodes,
                edges: edges,
                summary: {
                    document_id: documentId,
                    total_entities: allEntities.length,
                    total_nodes: nodes.length,
                    total_edges: edges.length,
                    density: edges.length / Math.max(1, nodes.length)
                }
            };

            logger.info(`🎉 Graph built successfully! ${nodes.length} nodes, ${edges.length} edges`);

            return graphData;

        } catch (error) {
            logger.error('❌ Graph building failed:', error);
            // Return empty graph instead of failing completely
            return {
                nodes: [],
                edges: [],
                error: error.message
            };
        }
    }

    /**
     * Extract entities from all chunks
     * 
     * 
     */

    /**
 * Format relevance safely (handle non-numbers)
 */
    formatRelevance(relevance) {
        if (typeof relevance === 'number') {
            return relevance.toFixed(1);
        }
        if (typeof relevance === 'string') {
            const num = parseFloat(relevance);
            return isNaN(num) ? '0.0' : num.toFixed(1);
        }
        return '0.0'; // Default if undefined/null/other
    }
    async extractEntitiesFromChunks(chunks) {
        try {
            const allEntitiesMap = new Map(); // Use Map to deduplicate by name

            // Process chunks in batches to avoid rate limits
            const batchSize = 5;
            for (let i = 0; i < chunks.length; i += batchSize) {
                const batch = chunks.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(chunks.length / batchSize);

                logger.info(`📦 Extracting entities from batch ${batchNumber}/${totalBatches} (chunks ${i}-${i + batch.length - 1})`);

                // Process each chunk in parallel
                const batchPromises = batch.map(async (chunk, index) => {
                    try {
                        const chunkIndex = i + index;
                        logger.debug(`  Analyzing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.content.length} chars)`);

                        const entities = await aiService.extractEntities(chunk.content);

                        // Filter by relevance and add to map
                        entities.forEach(entity => {
                            if (entity.relevance >= this.minEntityRelevance) {
                                const key = `${entity.name.toLowerCase()}_${entity.type}`;

                                if (allEntitiesMap.has(key)) {
                                    // Update existing entity: increase count, average relevance
                                    const existing = allEntitiesMap.get(key);
                                    existing.count += 1;
                                    existing.relevance = (existing.relevance + entity.relevance) / 2;
                                    existing.sources.add(chunkIndex);
                                } else {
                                    // Add new entity
                                    allEntitiesMap.set(key, {
                                        name: entity.name,
                                        type: entity.type,
                                        relevance: entity.relevance,
                                        count: 1,
                                        sources: new Set([chunkIndex]),
                                        metadata: {
                                            first_seen_chunk: chunkIndex,
                                            last_seen_chunk: chunkIndex
                                        }
                                    });
                                }
                            }
                        });

                    } catch (error) {
                        logger.warn(`Failed to extract entities from chunk ${i + index}:`, error.message);
                    }
                });

                await Promise.all(batchPromises);

                // Add delay between batches to avoid rate limits
                if (i + batchSize < chunks.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Convert Map to array and sort by relevance
            const allEntities = Array.from(allEntitiesMap.values())
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, 50); // Limit to top 50 entities

            logger.info(`📊 Entity statistics: ${allEntities.length} unique entities after filtering`);

            // Log top entities for debugging
            if (allEntities.length > 0) {
                const top10 = allEntities.slice(0, 10);
                logger.debug('🏆 Top 10 entities:');
                top10.forEach((entity, i) => {
                    const relevanceNum = Number(entity.relevance) || 0;
                    logger.debug(`  ${i + 1}. ${entity.name} (${entity.type}) - Relevance: ${relevanceNum.toFixed(1)}, Count: ${entity.count}`);
                });
            }

            return allEntities;

        } catch (error) {
            logger.error('Entity extraction failed:', error);
            return [];
        }
    }

    /**
     * Create graph nodes in database
     */
    async createGraphNodes(entities, documentId) {
        try {
            const nodes = [];

            for (const entity of entities) {
                try {
                    const nodeData = {
                        document_id: documentId,
                        name: entity.name,
                        type: entity.type,
                        metadata: {
                            relevance: entity.relevance,
                            occurrence_count: entity.count,
                            source_chunks: Array.from(entity.sources),
                            ...entity.metadata
                        }
                    };

                    const node = await supabaseService.createGraphNode(nodeData);

                    if (node) {
                        nodes.push({
                            id: node.id,
                            ...nodeData,
                            // Add visualization properties
                            size: Math.min(10 + (entity.relevance * 2), 30), // Node size based on relevance
                            color: this.getNodeColor(entity.type)
                        });
                    }

                } catch (error) {
                    logger.warn(`Failed to create node for entity ${entity.name}:`, error.message);
                }
            }

            return nodes;

        } catch (error) {
            logger.error('Node creation failed:', error);
            return [];
        }
    }

    /**
     * Analyze relationships between entities
     */
    async analyzeRelationships(chunks, nodes, documentId) {
        try {
            const edges = [];
            const nodeMap = new Map();

            // Create map for quick lookup
            nodes.forEach(node => {
                nodeMap.set(node.name.toLowerCase(), node.id);
            });

            // Simple co-occurrence analysis
            // Entities appearing in same chunk are likely related
            const cooccurrenceMap = new Map();

            // Analyze each chunk for co-occurring entities
            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                const chunk = chunks[chunkIndex];
                const chunkEntities = [];

                // Get entities in this chunk
                for (const node of nodes) {
                    // Simple string matching (could be improved with embeddings)
                    if (chunk.content.toLowerCase().includes(node.name.toLowerCase())) {
                        chunkEntities.push(node);
                    }
                }

                // Create edges between entities in same chunk
                for (let i = 0; i < chunkEntities.length; i++) {
                    for (let j = i + 1; j < chunkEntities.length; j++) {
                        const entity1 = chunkEntities[i];
                        const entity2 = chunkEntities[j];

                        const edgeKey = `${entity1.id}-${entity2.id}`;
                        const reverseKey = `${entity2.id}-${entity1.id}`;

                        // Check if edge already exists
                        if (!cooccurrenceMap.has(edgeKey) && !cooccurrenceMap.has(reverseKey)) {
                            cooccurrenceMap.set(edgeKey, {
                                source: entity1.id,
                                target: entity2.id,
                                weight: 1,
                                chunks: [chunkIndex]
                            });
                        } else {
                            // Increment weight for existing edge
                            const existingKey = cooccurrenceMap.has(edgeKey) ? edgeKey : reverseKey;
                            const edge = cooccurrenceMap.get(existingKey);
                            edge.weight += 1;
                            edge.chunks.push(chunkIndex);
                        }
                    }
                }
            }

            // Filter by minimum co-occurrence
            const validEdges = Array.from(cooccurrenceMap.values())
                .filter(edge => edge.weight >= this.minCooccurrence);

            // Create edges in database
            for (const edgeData of validEdges) {
                try {
                    // Determine relationship type based on entity types
                    const relationship = this.determineRelationship(
                        nodes.find(n => n.id === edgeData.source),
                        nodes.find(n => n.id === edgeData.target)
                    );

                    const edge = await supabaseService.createGraphEdge({
                        source_node: edgeData.source,
                        target_node: edgeData.target,
                        relationship: relationship,
                        weight: edgeData.weight,
                        metadata: {
                            cooccurrence_count: edgeData.weight,
                            source_chunks: edgeData.chunks
                        }
                    });

                    if (edge) {
                        edges.push({
                            id: edge.id,
                            source: edgeData.source,
                            target: edgeData.target,
                            relationship: relationship,
                            weight: edgeData.weight,
                            // Visualization properties
                            width: Math.min(edgeData.weight * 0.5, 5), // Line width based on weight
                            color: this.getEdgeColor(relationship)
                        });
                    }

                } catch (error) {
                    logger.warn(`Failed to create edge:`, error.message);
                }
            }

            // If we have few edges, create some semantic relationships using AI
            if (edges.length < 5 && nodes.length >= 2) {
                logger.info('Creating semantic relationships with AI...');
                const semanticEdges = await this.createSemanticRelationships(nodes, documentId);
                edges.push(...semanticEdges);
            }

            return edges;

        } catch (error) {
            logger.error('Relationship analysis failed:', error);
            return [];
        }
    }

    /**
     * Create semantic relationships using AI
     */
    async createSemanticRelationships(nodes, documentId) {
        try {
            const edges = [];

            // Take top 10 nodes and ask AI to find relationships
            const topNodes = nodes.slice(0, Math.min(10, nodes.length));

            if (topNodes.length < 2) return edges;

            // Prepare node list for AI
            const nodeList = topNodes.map(n => `${n.name} (${n.type})`).join(', ');

            const prompt = `Given these entities: ${nodeList}
            
            Identify 3-5 important relationships between them.
            Return as JSON array with objects containing:
            - entity1 (exact name from list)
            - entity2 (exact name from list) 
            - relationship (string describing relationship)
            - confidence (1-10)
            
            Example: [{"entity1": "Quantum Computing", "entity2": "Superposition", "relationship": "uses", "confidence": 8}]`;

            const messages = [
                { role: 'system', content: 'Return ONLY valid JSON array.' },
                { role: 'user', content: prompt }
            ];

            const response = await aiService.chatCompletion(messages, 0.1);

            try {
                const aiRelationships = JSON.parse(response);

                for (const rel of aiRelationships) {
                    try {
                        // Find node IDs
                        const node1 = topNodes.find(n => n.name === rel.entity1);
                        const node2 = topNodes.find(n => n.name === rel.entity2);

                        if (node1 && node2 && node1.id !== node2.id) {
                            const edge = await supabaseService.createGraphEdge({
                                source_node: node1.id,
                                target_node: node2.id,
                                relationship: rel.relationship,
                                weight: rel.confidence / 10, // Normalize to 0-1
                                metadata: {
                                    ai_generated: true,
                                    confidence: rel.confidence,
                                    method: 'semantic_analysis'
                                }
                            });

                            if (edge) {
                                edges.push({
                                    id: edge.id,
                                    source: node1.id,
                                    target: node2.id,
                                    relationship: rel.relationship,
                                    weight: rel.confidence / 10,
                                    width: Math.min((rel.confidence / 10) * 3, 4),
                                    color: '#9C27B0', // Purple for AI-generated edges
                                    metadata: { ai_generated: true }
                                });
                            }
                        }
                    } catch (error) {
                        logger.warn(`Failed to create AI relationship:`, error.message);
                    }
                }

                logger.info(`🤖 AI created ${edges.length} semantic relationships`);

            } catch (parseError) {
                logger.warn('Failed to parse AI relationships:', parseError);
            }

            return edges;

        } catch (error) {
            logger.error('Semantic relationship creation failed:', error);
            return [];
        }
    }

    /**
     * Determine relationship type based on entity types
     */
    determineRelationship(node1, node2) {
        const type1 = node1.type.toLowerCase();
        const type2 = node2.type.toLowerCase();

        const relationships = {
            'person-person': 'collaborates_with',
            'person-organization': 'works_at',
            'organization-organization': 'partners_with',
            'concept-concept': 'related_to',
            'concept-topic': 'belongs_to',
            'topic-topic': 'connected_to',
            'location-organization': 'located_in',
            'person-concept': 'researches',
            'default': 'associated_with'
        };

        const key = `${type1}-${type2}`;
        const reverseKey = `${type2}-${type1}`;

        return relationships[key] || relationships[reverseKey] || relationships.default;
    }

    /**
     * Get node color based on type
     */
    getNodeColor(type) {
        const colors = {
            'person': '#2196F3',      // Blue
            'organization': '#4CAF50', // Green
            'concept': '#FF9800',      // Orange
            'topic': '#9C27B0',        // Purple
            'location': '#F44336',     // Red
            'default': '#607D8B'       // Gray
        };

        return colors[type.toLowerCase()] || colors.default;
    }

    /**
     * Get edge color based on relationship type
     */
    getEdgeColor(relationship) {
        const colors = {
            'collaborates_with': '#2196F3',
            'works_at': '#4CAF50',
            'partners_with': '#8BC34A',
            'related_to': '#FF9800',
            'belongs_to': '#9C27B0',
            'connected_to': '#E91E63',
            'located_in': '#F44336',
            'researches': '#00BCD4',
            'associated_with': '#795548',
            'default': '#9E9E9E'
        };

        return colors[relationship] || colors.default;
    }

    /**
     * Get graph for a document
     */
    async getDocumentGraph(documentId) {
        try {
            return await supabaseService.getDocumentGraph(documentId);
        } catch (error) {
            logger.error('Get document graph failed:', error);
            return { nodes: [], edges: [] };
        }
    }

    /**
     * Get graph for multiple documents
     */
    async getUserGraph(userId) {
        try {
            logger.info(`Getting user graph for: ${userId}`);

            // REMOVED UUID CHECK - Only check for actual demo user
            if (userId === 'demo-user-123') {
                logger.info(`Demo user detected - returning empty graph`);
                return {
                    nodes: [],
                    edges: [],
                    summary: {
                        total_documents: 0,
                        total_nodes: 0,
                        total_edges: 0,
                        message: 'Upload documents to build your knowledge graph'
                    }
                };
            }

            // Get all documents for user
            const result = await supabaseService.getUserDocuments({ userId: userId });
            const documents = result.documents;

            if (!documents || documents.length === 0) {
                logger.info(`No documents found for user ${userId}`);
                return {
                    nodes: [],
                    edges: [],
                    summary: {
                        total_documents: 0,
                        total_nodes: 0,
                        total_edges: 0
                    }
                };
            }

            logger.info(`Found ${documents.length} documents for user ${userId}`);

            // Get graph for each document and combine
            const allNodes = [];
            const allEdges = [];
            const nodeIdMap = new Map(); // Track node IDs to avoid duplicates

            let processedDocuments = 0;

            for (const doc of documents) {
                try {
                    logger.debug(`Getting graph for document: ${doc.filename} (${doc.id})`);
                    const graph = await this.getDocumentGraph(doc.id);

                    // Add nodes with document context
                    graph.nodes.forEach(node => {
                        const uniqueKey = `${node.name}_${node.type}`;
                        if (!nodeIdMap.has(uniqueKey)) {
                            nodeIdMap.set(uniqueKey, true);
                            allNodes.push({
                                ...node,
                                document_id: doc.id,
                                document_name: doc.filename
                            });
                        }
                    });

                    // Add edges
                    allEdges.push(...graph.edges);
                    processedDocuments++;

                    logger.debug(`Document processed: ${doc.filename} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);

                } catch (error) {
                    logger.warn(`Failed to get graph for document ${doc.id}:`, error.message);
                }
            }

            logger.info(`User graph completed: ${allNodes.length} nodes, ${allEdges.length} edges from ${processedDocuments}/${documents.length} documents`);

            return {
                nodes: allNodes,
                edges: allEdges,
                summary: {
                    total_documents: documents.length,
                    processed_documents: processedDocuments,
                    total_nodes: allNodes.length,
                    total_edges: allEdges.length,
                    documents: documents.map(doc => ({
                        id: doc.id,
                        filename: doc.filename,
                        status: doc.status
                    }))
                }
            };

        } catch (error) {
            logger.error('Get user graph failed:', error);
            return {
                nodes: [],
                edges: [],
                summary: {
                    total_documents: 0,
                    total_nodes: 0,
                    total_edges: 0,
                    error: error.message
                }
            };
        }
    }

    /**
     * Delete graph for a document
     */
    async deleteDocumentGraph(documentId) {
        try {
            await supabaseService.deleteDocumentGraph(documentId);
            logger.info(`Deleted graph for document ${documentId}`);
            return { success: true };
        } catch (error) {
            logger.error('Delete document graph failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Find related concepts for a query
     */
    async findRelatedConcepts(query, userId) {
        try {
            logger.info(`Finding related concepts for query: "${query}" (user: ${userId})`);

            // ONLY check for actual demo user - REMOVED UUID CHECK
            if (!userId || userId === 'demo-user-123') {
                logger.info(`Demo/invalid user (${userId}) - skipping graph search`);
                return {
                    concepts: [],
                    graph: {
                        nodes: [],
                        edges: [],
                        summary: {
                            total_documents: 0,
                            total_nodes: 0,
                            total_edges: 0
                        }
                    },
                    query_entities: [],
                    message: 'Upload documents to build your knowledge graph'
                };
            }

            // Extract entities from query
            const queryEntities = await aiService.extractEntities(query);
            logger.info(`Query entities extracted: ${queryEntities.length}`);

            if (queryEntities.length === 0) {
                return {
                    concepts: [],
                    graph: {
                        nodes: [],
                        edges: [],
                        summary: {
                            total_documents: 0,
                            total_nodes: 0,
                            total_edges: 0
                        }
                    },
                    query_entities: []
                };
            }

            logger.debug('Query entities:', queryEntities);

            // Get user's graph (now with validated userId)
            const userGraph = await this.getUserGraph(userId);

            if (userGraph.nodes.length === 0) {
                logger.info('No graph nodes found for user');
                return {
                    concepts: [],
                    graph: userGraph,
                    query_entities: queryEntities
                };
            }

            logger.info(`User graph loaded: ${userGraph.nodes.length} nodes, ${userGraph.edges.length} edges`);

            // Find matching nodes
            const relatedNodes = [];
            const queryEntityNames = queryEntities.map(e => e.name.toLowerCase());

            userGraph.nodes.forEach(node => {
                const nodeName = node.name.toLowerCase();
                if (queryEntityNames.some(queryName =>
                    nodeName.includes(queryName) || queryName.includes(nodeName)
                )) {
                    relatedNodes.push(node);
                }
            });

            logger.info(`Found ${relatedNodes.length} related nodes`);

            // Find edges connected to related nodes
            const relatedEdges = userGraph.edges.filter(edge =>
                relatedNodes.some(node => node.id === edge.source) ||
                relatedNodes.some(node => node.id === edge.target)
            );

            logger.info(`Found ${relatedEdges.length} related edges`);

            // Get connected nodes (2 degrees of separation)
            const connectedNodeIds = new Set();
            relatedEdges.forEach(edge => {
                connectedNodeIds.add(edge.source);
                connectedNodeIds.add(edge.target);
            });

            const connectedNodes = userGraph.nodes.filter(node =>
                connectedNodeIds.has(node.id)
            );

            logger.info(`Total connected nodes: ${connectedNodes.length}`);

            return {
                concepts: relatedNodes,
                graph: {
                    nodes: connectedNodes,
                    edges: relatedEdges,
                    summary: userGraph.summary
                },
                query_entities: queryEntities,
                metadata: {
                    query_processed: query,
                    user_id: userId,
                    total_matches: relatedNodes.length,
                    graph_size: {
                        nodes: userGraph.nodes.length,
                        edges: userGraph.edges.length,
                        documents: userGraph.summary?.total_documents || 0
                    }
                }
            };

        } catch (error) {
            logger.error('Find related concepts failed:', error);
            return {
                concepts: [],
                graph: {
                    nodes: [],
                    edges: [],
                    summary: {
                        total_documents: 0,
                        total_nodes: 0,
                        total_edges: 0,
                        error: error.message
                    }
                },
                query_entities: []
            };
        }
    }
    /**
     * Health check
     */
    async healthCheck() {
        try {
            // Test entity extraction with sample text
            const sampleText = "Artificial intelligence and machine learning are transforming technology.";
            const entities = await aiService.extractEntities(sampleText);

            return {
                healthy: true,
                entity_extraction: entities.length > 0,
                min_relevance_threshold: this.minEntityRelevance,
                max_entities_per_chunk: this.maxEntitiesPerChunk
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }
}

module.exports = new MemoryGraph();