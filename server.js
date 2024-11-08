const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

app.post('/upload', upload.single('file'), async (req, res) => {
    const filePath = path.join(__dirname, req.file.path);
    const { documentType } = req.body;

    try {
        // Perform OCR on the uploaded image
        const ocrResult = await Tesseract.recognize(filePath, 'eng');
        const extractedText = ocrResult.data.text;
        
        // Log extracted text for debugging
        // console.log("Extracted Text:", extractedText);

        // Save OCR output to JSON file (optional for debugging)
        const jsonData = { extractedText };
        await fs.writeJson('data.json', jsonData);

        // Apply regex based on the document type
        const extractedInfo = extractDetailsFromText(extractedText, documentType);

        res.json(extractedInfo);
    } catch (error) {
        console.error("Error processing file:", error);
        res.status(500).json({ error: 'Error processing file', details: error.message });
    } finally {
        await fs.remove(filePath);
    }
});

app.listen(5000, () => {
    console.log('Server is running on http://localhost:5000');
});

// Function to extract details using document-specific regex patterns
function extractDetailsFromText(text, documentType) {
    // Handle JSON string input
    if (text.startsWith('{')) {
        try {
            text = JSON.parse(text).extractedText;
        } catch (e) {
            console.error('Error parsing JSON:', e);
        }
    }

    // Normalize the text by replacing multiple spaces and newlines with a single space
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    
    let details = {
        name: 'Not found',
        documentNumber: 'Not found',
        expirationDate: 'Not found',
        dateOfBirth: 'Not found'
    };

    if (documentType === 'driving_license') {
        // Generalized patterns for Driving License
        const dlPatterns = {
            // Match any name that follows "Name" keyword
            name: /Name\s*©?\s*([A-Z][A-Za-z\s]+?)(?=\s*(?:S\/|D\/|W\/|$|\n))/i,
            
            // Updated pattern to specifically look for DL NO and capture everything after it until next field
            documentNumber: /(?:DL\s+NO|License\s+No)\s*©?\s*'?([^:]+?)(?=\s+(?:DOI|$|\n))/i,
            
            // Match expiration date in common Indian formats
            expirationDate: /(?:Valid upto|Valid Till|Validity|Expiry)\s*:?\s*(\d{2}-\d{2}-\d{4}|\d{2}-\d{2}\s*-\d{4})/i,
            
            // Match date of birth in common formats
            dateOfBirth: /(?:DOB|Date of Birth)\s*:?\s*(\d{2}-\d{2}-\d{4})/i
        };

        // Extract details for driving license
        Object.entries(dlPatterns).forEach(([key, pattern]) => {
            const match = normalizedText.match(pattern);
            if (match && match[1]) {
                details[key] = match[1].trim();
            }
        });

        // Clean up expiration date by removing extra spaces
        if (details.expirationDate !== 'Not found') {
            details.expirationDate = details.expirationDate.replace(/\s+/g, '');
        }

    } else if (documentType === 'passport') {
        // Generalized patterns for Passport
        
        // Extract passport number (letter followed by 7-8 digits)
        const passportMatch = normalizedText.match(/[A-Z][0-9]{7,8}/i);
        if (passportMatch) {
            details.documentNumber = passportMatch[0].toUpperCase();
        }

        // Try to extract name from MRZ first
        const mrzMatch = normalizedText.match(/P<[A-Z]{3}([A-Z]+)<<([A-Z]+)/);
        if (mrzMatch) {
            const surname = mrzMatch[1].replace(/</g, ' ').trim();
            const givenNames = mrzMatch[2].replace(/</g, ' ').trim();
            details.name = `${surname} ${givenNames}`.trim();
        } else {
            // Fallback: Look for consecutive capital words
            const nameMatch = normalizedText.match(/(?<!(?:Valid|Signature|Authority|Place|Date|Passport|No)\s+)[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+){1,2}(?!\s+(?:INDIA|PASSPORT|REPUBLIC))/);
            if (nameMatch) {
                details.name = nameMatch[0].trim();
            }
        }

        // Extract dates in DD/MM/YYYY format
        const dateMatches = [...normalizedText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)];
        if (dateMatches.length >= 2) {
            details.dateOfBirth = dateMatches[0][0];
            details.expirationDate = dateMatches[dateMatches.length - 1][0];
        }
    }

    // Final cleanup of all extracted data
    return Object.fromEntries(
        Object.entries(details).map(([key, value]) => [
            key,
            value.replace(/\s+/g, ' ').trim()
        ])
    );
}
