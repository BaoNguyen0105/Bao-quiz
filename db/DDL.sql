-- Active: 1779105528295@@bao-sql-bao-quiz-app.e.aivencloud.com@14640@quiz_app
DROP SCHEMA IF EXISTS `quiz_app`;
CREATE SCHEMA IF NOT EXISTS `quiz_app`;
-- Drop tables in reverse order of dependencies to avoid foreign key constraints failing
DROP TABLE IF EXISTS Q_IMAGE;
DROP TABLE IF EXISTS `Option`;

-- Drop the cross-reference foreign key constraint before dropping the Question table
-- This breaks the circular dependency loop between Question and Option
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS Question;
SET FOREIGN_KEY_CHECKS = 1;

DROP TABLE IF EXISTS Quiz;

-- -----------------------------------------------------
-- Table: Quiz
-- Holds the top-level configuration framework for your quizzes.
-- -----------------------------------------------------

USE `quiz_app`;
CREATE TABLE Quiz (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------
-- Table: Question
-- Contains the question text and a direct reference to the correct choice.
-- -----------------------------------------------------
CREATE TABLE Question (
    id INT PRIMARY KEY AUTO_INCREMENT,
    quiz_id INT NOT NULL,
    question_text TEXT NOT NULL,
    correct_option_id INT NULL, -- Points to the true choice. Initially NULL during creation.
    CONSTRAINT fk_question_quiz 
        FOREIGN KEY (quiz_id) REFERENCES Quiz(id) 
        ON DELETE CASCADE
);

-- -----------------------------------------------------
-- Table: Option
-- Relates choice variations back to their respective parent question stem.
-- -----------------------------------------------------
CREATE TABLE `Option` (
    id INT PRIMARY KEY AUTO_INCREMENT,
    question_id INT NOT NULL,
    option_text TEXT NOT NULL,
    CONSTRAINT fk_option_question 
        FOREIGN KEY (question_id) REFERENCES Question(id) 
        ON DELETE CASCADE
);

-- -----------------------------------------------------
-- Circular Dependency Bridge
-- Enforces that a question can point to exactly ONE valid correct option.
-- ON DELETE SET NULL ensures that if you delete an individual option choice, 
-- it won't trigger a recursive deletion crash on the parent question.
-- -----------------------------------------------------
ALTER TABLE Question 
ADD CONSTRAINT fk_correct_option 
FOREIGN KEY (correct_option_id) REFERENCES `Option`(id) 
ON DELETE SET NULL;

-- -----------------------------------------------------
-- Table: Q_IMAGE
-- Supports multiple locally stored or cloud-hosted image paths per question.
-- -----------------------------------------------------
CREATE TABLE Q_IMAGE (
    id INT PRIMARY KEY AUTO_INCREMENT,
    question_id INT NOT NULL,
    image_url VARCHAR(255) NOT NULL, -- Currently stores local file paths (e.g., '/uploads/img.png')
    CONSTRAINT fk_image_question 
        FOREIGN KEY (question_id) REFERENCES Question(id) 
        ON DELETE CASCADE
);