import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
	console.log('Handling incoming event', JSON.stringify(event));
	const impactBucketName = process.env.IMPACT_BUCKET_NAME;

	const { orgName, projectData } = event;

	console.log('Org Name: ', orgName);
	console.log('Project Data: ', projectData);

	if (!orgName || !projectData || !impactBucketName) {
		console.error('Error: Missing required parameters');
		throw new Error('Missing required parameters');
	}

	const projectName = projectData['project-name'].replace(
		/[^a-zA-Z0-9()]/g,
		'_'
	);

	// 1. Transform projectData to CSV
	const csvString = convertToCSV(projectData);

	// 2. Save the CSV to S3
	const csvPath = `${orgName}/${projectName}_rawImpactAssessment.csv`;
	await uploadToS3(csvPath, csvString, impactBucketName);

	return {
		Payload: { orgName, projectName }
	};
};

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

async function uploadToS3(csvPath: string, csvRaw: string, bucketName: string) {
	console.log(`Uploading to S3 bucket ${bucketName}`);
	await s3Client.send(
		new PutObjectCommand({
			Bucket: bucketName,
			Key: csvPath,
			Body: csvRaw,
			ContentType: 'text/csv'
		})
	);
}
