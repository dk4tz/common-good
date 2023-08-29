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
	console.log('Received event:', JSON.stringify(event));

	const impactBucketName = process.env.IMPACT_BUCKET_NAME;
	const { orgName, projectData } = event;

	if (!orgName || !projectData || !impactBucketName) {
		console.error('Error: Missing required parameters');
		throw new Error('Missing required parameters');
	}

	console.log('Org Name: ', orgName);
	console.log('Project Name: ', projectData['project-name']);
	console.log('Project Data: ', projectData);

	const projectName = projectData['project-name'];

	// await uploadToS3(orgName, csvRaw, config.bucketName);
	return {
		Payload: { orgName, projectName }
	};
};

async function uploadToS3(orgName: string, csvRaw: string, bucketName: string) {
	console.log(`Uploading to S3 bucket ${bucketName}`);
	await s3Client.send(
		new PutObjectCommand({
			Bucket: bucketName,
			Key: `${orgName}/impactAssessmentRaw.csv`,
			Body: csvRaw,
			ContentType: 'text/csv'
		})
	);
}
