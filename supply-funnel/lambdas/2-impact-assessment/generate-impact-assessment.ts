import { DIMENSIONS, QUESTIONS } from './scoring-key';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PDFDocument, rgb } from 'pdf-lib';

interface StepFunctionEvent {
	orgName?: string;
	projectData?: { [key: string]: string };
	bucketName?: string;
}
interface LambdaResponse {
	Payload: { orgName: string; projectName: string };
}
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (
	event: StepFunctionEvent
): Promise<LambdaResponse> => {
	try {
		// Log the incoming event for debugging
		console.log('Received event:', JSON.stringify(event));

		// Retrieve bucket name from environment variables
		const impactBucketName = process.env.IMPACT_BUCKET_NAME;

		// Extract orgName and projectData from the event
		const { orgName, projectData } = event;
		console.log('Organisation Name:', orgName);
		console.log('Project Data:', projectData);

		// Validate that necessary parameters are present
		if (!orgName || !projectData || !impactBucketName) {
			console.error('Error: Missing required parameters');
			throw new Error('Missing required parameters');
		}

		// Clean up the project name for use in file paths by replacing non-alphanumeric characters
		const projectName = projectData['project-name'].replace(
			/[^a-zA-Z0-9()]/g,
			'_'
		);

		// Convert the provided project data into a CSV format
		const csvString = convertToCSV(projectData);

		// Save the CSV to S3 in a structured path
		const csvPath = `${orgName}/${projectName}_rawImpactAssessment.csv`;
		await uploadToS3(csvPath, csvString, impactBucketName);

		// Calculate the impact assessment score based on project data
		const { dimensionResults, totalScore } = calculateScore(projectData);

		// Generate a PDF report for the project's impact assessment
		const pdfBuffer = await generateImpactAssessmentPDF(
			dimensionResults,
			totalScore
		);

		// Save the generated PDF to S3 in a structured path
		const pdfPath = `${orgName}/${projectName}_impactAssessmentReport.pdf`;
		await uploadToS3(pdfPath, pdfBuffer, impactBucketName);

		// Return the organization and project name to the Step Function
		return {
			Payload: { orgName, projectName }
		};
	} catch (error) {
		// Handle errors by logging and re-throwing
		const errorMessage =
			error instanceof Error
				? error.message
				: 'An unexpected error occurred';
		console.error('Error processing:', errorMessage);
		throw new Error(errorMessage);
	}
};

async function generateImpactAssessmentPDF(
	dimensionResults: Record<string, number>,
	totalScore: number
) {
	const pdfDoc = await PDFDocument.create();
	const page = pdfDoc.addPage([600, 400]);

	const titleFont = await pdfDoc.embedFont('Times-Roman');
	const contentFont = await pdfDoc.embedFont('Times-Roman');

	// Title
	page.drawText('Common Good Marketplace Impact Assessment Report', {
		x: 50,
		y: 375,
		size: 24,
		font: titleFont,
		color: rgb(0, 0, 0)
	});

	// Analysis of Dimensions
	let yPos = 325;
	for (const dimension in dimensionResults) {
		let color;

		if (dimensionResults[dimension] > 70) {
			color = rgb(0.7, 1, 0.7); // Pastel green
		} else if (
			dimensionResults[dimension] >= 30 &&
			dimensionResults[dimension] <= 70
		) {
			color = rgb(1, 1, 0.7); // Pastel yellow
		} else {
			color = rgb(1, 0.7, 0.7); // Pastel red
		}

		page.drawText(
			`${dimension}: ${Math.round(dimensionResults[dimension])}%`,
			{
				x: 50,
				y: yPos,
				size: 20,
				font: contentFont,
				color: color
			}
		);
		yPos -= 25;
	}

	// Total Score
	page.drawText(`Total Score: ${totalScore}%`, {
		x: 50,
		y: yPos,
		size: 20,
		font: contentFont,
		color: rgb(0, 0, 0)
	});
	yPos -= 30;

	// Analysis Section
	page.drawText(`Analysis:`, {
		x: 50,
		y: yPos,
		size: 20,
		font: titleFont,
		color: rgb(0, 0, 0)
	});
	yPos -= 25;

	for (const dimension in dimensionResults) {
		// Sample analysis text. You can add more detailed descriptions here.
		const analysisText = `${dimension} has a score of ${dimensionResults[dimension]}, indicating it's importance in the project.`;

		page.drawText(analysisText, {
			x: 50,
			y: yPos,
			size: 16,
			font: contentFont,
			color: rgb(0, 0, 0)
		});
		yPos -= 20;
	}

	// Return PDF as Buffer
	const pdfBytes = await pdfDoc.save();
	return Buffer.from(pdfBytes);
}

interface ScoreResult {
	dimensionResults: { [key: string]: number };
	totalScore: number;
}

/**
 * Calculate scores based on project data.
 * @param projectData - An object containing responses to various questions.
 * @returns {ScoreResult} An object containing the final dimension results and the total score.
 */
function calculateScore(projectData: { [key: string]: string }): ScoreResult {
	// Objects to store scores for each dimension: raw score, max possible score, and percentage result.
	let rawScores: { [key: string]: number } = {};
	let weightedScores: { [key: string]: number } = {};
	let maxWeightedScores: { [key: string]: number } = {};
	let dimensionResults: { [key: string]: number } = {};

	// Initialize default values for each dimension.
	for (let dimension in DIMENSIONS) {
		dimensionResults[dimension] = 0;
		weightedScores[dimension] = 0;
		maxWeightedScores[dimension] = 0;
	}

	// Iterate over each question to calculate weighted scores and max possible scores for each dimension.
	QUESTIONS.forEach((question) => {
		// Check if the project's answer to the question exists in the predefined responses. This is for sanity checks and debugging.
		if (!(projectData[question.question] in question.responses)) {
			// Log an error if the project's answer doesn't match any predefined responses.
			console.error(
				`Question: ${question.question}\n` +
					`Given Answer: ${projectData[question.question]}\n` +
					`Valid Answers: ${Object.keys(question.responses).join(
						'\n'
					)}`
			);
		}

		// Get the score for the project's answer to the question. Set to 0 if not found.
		const responseScore =
			question.responses[projectData[question.question]] || 0;

		// Record the raw score for the given question. This is for tracking.
		rawScores[question.question] = responseScore;

		// Get the max possible raw score for the question.
		const maxQuestionScore = Math.max(...Object.values(question.responses));

		// Add the current question's weighted score and maximum score to its dimension.
		weightedScores[question.dimension] += Math.round(
			responseScore * question.weight
		);
		maxWeightedScores[question.dimension] += Math.round(
			maxQuestionScore * question.weight
		);
	});

	// Compute the dimension's score percentage from its weighted score and max score.
	for (let dimension in DIMENSIONS) {
		dimensionResults[dimension] =
			(weightedScores[dimension] / maxWeightedScores[dimension]) * 100;
	}

	// Aggregate the weighted scores and max scores across all dimensions.
	let totalWeightedScore = 0;
	let totalMaxWeightedScore = 0;
	for (let dimension in DIMENSIONS) {
		totalWeightedScore += weightedScores[dimension] * DIMENSIONS[dimension];
		totalMaxWeightedScore +=
			maxWeightedScores[dimension] * DIMENSIONS[dimension];
	}

	// Calculate the overall percentage score for the project based on aggregated values.
	const totalScore = Math.round(
		(totalWeightedScore / totalMaxWeightedScore) * 100
	);

	console.log('Raw Scores:', rawScores);
	console.log('Weighted Scores:', weightedScores);
	console.log('Max Weighted Scores:', maxWeightedScores);
	console.log('Dimension Results:', dimensionResults);
	console.log('Total Score:', totalScore);

	return {
		dimensionResults,
		totalScore
	};
}

function convertToCSV(keyValues: any): string {
	return Object.entries(keyValues)
		.map(([key, value]) => {
			// Convert the key and value to strings to ensure proper handling
			let keyStr = String(key);
			let valueStr = String(value);

			// Escape double quotes and commas within the key and value
			keyStr = `"${keyStr.replace(/"/g, '""')}"`;
			valueStr = `"${valueStr.replace(/"/g, '""')}"`;

			return `${keyStr},${valueStr}`;
		})
		.join('\n');
}

async function uploadToS3(
	filePath: string,
	fileRaw: string | Buffer,
	bucketName: string
): Promise<void> {
	try {
		let contentType: string;

		// Determine content type based on file extension
		if (filePath.endsWith('.csv')) {
			contentType = 'text/csv';
		} else if (filePath.endsWith('.pdf')) {
			contentType = 'application/pdf';
		} else {
			throw new Error(`Unsupported file type for path ${filePath}`);
		}

		console.log(`Uploading ${filePath} to S3 bucket ${bucketName}`);

		await s3Client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: filePath,
				Body: fileRaw,
				ContentType: contentType
			})
		);

		console.log(
			`Successfully uploaded ${filePath} to S3 bucket ${bucketName}`
		);
	} catch (error) {
		console.error(
			`Failed to upload ${filePath} to S3 bucket ${bucketName}. Error: ${error}`
		);
		throw error;
	}
}
