import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const s3Client = new S3Client({ region: 'us-east-1' });
const sfnClient = new SFNClient({ region: 'us-east-1' });

const bucketName = process.env.BUCKET_NAME;
const stateMachineArn = process.env.STATE_MACHINE_ARN;

export const handler = async (
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
	// Check for existence of event body
	if (!event.body) {
		throw new Error('No event body');
	}

	// Log incoming event
	console.log('Handling incoming event', event);

	// Parse the input event
	const input = JSON.parse(event.body);

	// Handle challenge events
	if ('challenge' in input) {
		return handleChallengeEvent(input);
	}

	// Handle create_pulse events
	if (input.event.type === 'create_pulse') {
		return await handleCreatePulseEvent(input);
	}

	// Handle unknown events
	console.log('Unknown event received!');
	return {
		statusCode: 400,
		body: JSON.stringify({
			message: 'Event not handled'
		})
	};
};

const handleChallengeEvent = (input: any) => {
	console.log('Challenge event received!');
	return {
		statusCode: 200,
		body: JSON.stringify({
			challenge: input.challenge
		})
	};
};

const handleCreatePulseEvent = async (input: any) => {
	console.log('Create event received!', input);
	const projectName = input.event.pulseName;
	const projectData = input.event.columnValues;

	// Extract and log key values
	const keyValues = extractKeyValues(projectData);
	console.log('Extracted Key Values:', keyValues);

	// Prepare and log data for CSV
	const csvRaw = prepareCsvData(keyValues);
	console.log('Content of impactAssessmentRaw.csv:', csvRaw);

	// Upload data to S3
	await uploadToS3(projectName, csvRaw);

	// Start the Step Functions state machine execution // New
	await startStepFunctionsExecution(keyValues);

	return {
		statusCode: 200,
		body: JSON.stringify({
			message: 'Event handled successfully'
		})
	};
};

const extractKeyValues = (projectData: any) => {
	let keyValues: any = {};
	for (let key in projectData) {
		if (projectData[key].date) {
			keyValues[key] = projectData[key].date;
		} else if (projectData[key].text) {
			keyValues[key] = projectData[key].text;
		} else if (projectData[key].label && projectData[key].label.text) {
			keyValues[key] = projectData[key].label.text;
		} else if (projectData[key].value !== undefined) {
			keyValues[key] = projectData[key].value;
		}
	}
	return keyValues;
};

const prepareCsvData = (keyValues: any) => {
	let csvRaw = 'Key,Value\n'; // CSV column headers
	for (let key in keyValues) {
		let value = keyValues[key].toString().replace(/"/g, '""'); // Convert to string and escape any double quotes in the value
		csvRaw += `"${key}","${value}"\n`; // Each line is a key-value pair enclosed in double quotes
	}
	return csvRaw;
};

const uploadToS3 = async (projectName: string, csvRaw: string) => {
	const uploadCommand = new PutObjectCommand({
		Bucket: bucketName,
		Key: `${projectName}/impactAssessmentRaw.csv`,
		Body: csvRaw,
		ContentType: 'text/csv'
	});

	try {
		const s3Response = await s3Client.send(uploadCommand);
		console.log('Upload response:', s3Response);
	} catch (err) {
		console.error('Upload failed:', err);
	}
	console.log('Upload complete!');
};

const startStepFunctionsExecution = async (keyValues: any) => {
	// New
	const startExecutionCommand = new StartExecutionCommand({
		stateMachineArn: stateMachineArn,
		input: JSON.stringify(keyValues) // The data that will be passed to the state machine as input
	});

	try {
		const sfnResponse = await sfnClient.send(startExecutionCommand);
		console.log('Step Functions response:', sfnResponse);
	} catch (err) {
		console.error('Step Functions execution failed:', err);
	}
	console.log('Step Functions execution started!');
};
