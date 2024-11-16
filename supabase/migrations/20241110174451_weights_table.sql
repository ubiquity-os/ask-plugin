
CREATE TABLE IF NOT EXISTS weights (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    weight DECIMAL NOT NULL,
    phrase TEXT NOT NULL,
    comment_node_id VARCHAR REFERENCES issue_comments(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE OR REPLACE FUNCTION get_weight(input_phrase TEXT)
RETURNS DECIMAL AS $$
DECLARE
    result_weight DECIMAL;
BEGIN
    -- Exact Match
    WITH exact_matches AS (
        SELECT 
            w.weight,
            COALESCE((ic.payload->'reactions'->>'+1')::int, 0) AS upvotes,
            COALESCE((ic.payload->'reactions'->>'-1')::int, 0) AS downvotes
        FROM weights w
        LEFT JOIN issue_comments ic ON w.comment_node_id = ic.id
        WHERE lower(w.phrase) = lower(input_phrase)
    )
    SELECT 
        CASE 
            WHEN COUNT(*) > 0 THEN 
                -- If more than one exact match, return the average weight
                AVG(weight * (1.0 + (upvotes - downvotes) * 0.1))
            ELSE NULL
        END
    INTO result_weight
    FROM exact_matches;

    -- If Exact Match found, return the weight
    IF result_weight IS NOT NULL THEN
        RETURN result_weight;
    END IF;

    -- If no match, try to find similar phrases
    WITH tokenized_input AS (
        SELECT regexp_split_to_array(lower(input_phrase), '\s+') AS words
    ),
    similar_phrases AS (
        SELECT 
            w.weight,
            w.comment_node_id,
            w.phrase,
            -- Any order of the phrase
            (SELECT bool_and(w_word ILIKE ANY(regexp_split_to_array(lower(w.phrase), '\s+')))
             FROM unnest((SELECT words FROM tokenized_input)) AS w_word) AS contains_all_words,
            -- Overlap ratio of words
            array_length(
                array(
                    SELECT DISTINCT unnest((SELECT words FROM tokenized_input))
                    INTERSECT
                    SELECT DISTINCT unnest(regexp_split_to_array(lower(w.phrase), '\s+'))
                ), 1
            )::float / 
            GREATEST(
                array_length((SELECT words FROM tokenized_input), 1),
                array_length(regexp_split_to_array(lower(w.phrase), '\s+'), 1)
            ) AS word_overlap_ratio,
            similarity(lower(input_phrase), lower(w.phrase)) as similarity_score
        FROM weights w
        WHERE 
            -- Use trigram similarity for fuzzy matching
            similarity(lower(input_phrase), lower(w.phrase)) > 0.3
            OR 
            EXISTS (
                SELECT 1
                FROM unnest((SELECT words FROM tokenized_input)) AS input_word
                WHERE lower(w.phrase) ILIKE '%' || input_word || '%'
            )
    ),
    weighted_matches AS (
        SELECT 
            sp.weight,
            sp.contains_all_words,
            sp.word_overlap_ratio,
            sp.similarity_score,
            sp.phrase,
            COALESCE((ic.payload->'reactions'->>'+1')::int, 0) AS upvotes,
            COALESCE((ic.payload->'reactions'->>'-1')::int, 0) AS downvotes
        FROM similar_phrases sp
        LEFT JOIN issue_comments ic ON sp.comment_node_id = ic.id
        WHERE 
            sp.similarity_score > 0 OR
            sp.contains_all_words OR
            sp.word_overlap_ratio > 0.5
    ),
    grouped_matches AS (
        -- Group by phrase to handle multiple entries of same/similar phrases
        SELECT 
            phrase,
            AVG(weight) as avg_base_weight,
            MAX(contains_all_words::int) as contains_all_words,
            MAX(word_overlap_ratio) as word_overlap_ratio,
            MAX(similarity_score) as similarity_score,
            SUM(upvotes) as total_upvotes,
            SUM(downvotes) as total_downvotes
        FROM weighted_matches
        GROUP BY phrase
    )
    SELECT 
        CASE 
            WHEN COUNT(*) = 0 THEN 0
            ELSE AVG(
                -- Base weight
                avg_base_weight * (
                    CASE 
                        WHEN contains_all_words = 1 THEN 1.0
                        ELSE GREATEST(word_overlap_ratio, similarity_score)
                    END
                ) * 
                -- Apply accumulated reactions
                (1.0 + (total_upvotes - total_downvotes) * 0.1)
            )
        END
    INTO result_weight
    FROM grouped_matches;

    RETURN COALESCE(result_weight, 0);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_weight(phrase TEXT, weight DECIMAL, commentNodeId VARCHAR)
RETURNS VOID AS $$
BEGIN
    INSERT INTO weights (weight, phrase, comment_node_id)
    VALUES (weight, phrase, commentNodeId)
    ON CONFLICT (phrase) DO UPDATE SET
        weight = EXCLUDED.weight,
        comment_node_id = EXCLUDED.comment_node_id,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;