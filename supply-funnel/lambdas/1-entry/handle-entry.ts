// AWS SDK imports
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

// AWS clients initialization
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

// Main handler for incoming requests
export const handler = async (
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
	const { bucketName, stateMachineArn } = await init();

	if (!event.body) {
		throw new Error('No event body');
	}

	console.log('Handling incoming event', event);
	const input = JSON.parse(event.body);

	if ('challenge' in input) {
		return handleChallengeEvent(input);
	}

	if (input.event.type === 'create_pulse') {
		return await handleCreatePulseEvent(input, bucketName, stateMachineArn);
	}

	console.log('Unknown event received!');
	return {
		statusCode: 400,
		body: JSON.stringify({ message: 'Event not handled' })
	};
};

// Function to fetch parameters from AWS SSM
async function getParam(param: string): Promise<string> {
	const response = await ssmClient.send(
		new GetParameterCommand({ Name: param })
	);
	if (!response.Parameter?.Value) {
		throw new Error(`Failed to get ${param} from SSM`);
	}
	return response.Parameter.Value;
}

// Initialize key variables at the beginning of the Lambda execution
async function init() {
	const bucketName = await getParam('/supply-funnel/s3-bucket-name');
	const stateMachineArn = await getParam('/supply-funnel/state-machine-arn');
	return { bucketName, stateMachineArn };
}

// Function to handle the Challenge event from Monday.com webhook initialization
async function handleChallengeEvent(input: any) {
	console.log('Challenge event received!');
	return {
		statusCode: 200,
		body: JSON.stringify({ challenge: input.challenge })
	};
}

// Function to handle the CreatePulse event from Monday.com webhook
async function handleCreatePulseEvent(
	input: any,
	bucketName: string,
	stateMachineArn: string
) {
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
	await uploadToS3(projectName, csvRaw, bucketName);

	// Start the Step Functions state machine execution
	await startStepFunctionsExecution(keyValues, stateMachineArn);

	return {
		statusCode: 200,
		body: JSON.stringify({ message: 'Event handled successfully' })
	};
}

// Function to extract key-value pairs from the project data
function extractKeyValues(projectData: any) {
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
}

// Function to prepare a CSV project report from the key-value pairs
function prepareCsvData(keyValues: any) {
	let csvRaw = 'Key,Value\n'; // CSV column headers
	for (let key in keyValues) {
		let value = keyValues[key].toString().replace(/"/g, '""'); // Convert to string and escape any double quotes in the value
		csvRaw += `"${key}","${value}"\n`; // Each line is a key-value pair enclosed in double quotes
	}
	return csvRaw;
}

// Function to project reports to S3
async function uploadToS3(
	projectName: string,
	csvRaw: string,
	bucketName: string
) {
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
		throw err;
	}
	console.log('Upload complete!');
}

// Function to start the Step Functions execution
async function startStepFunctionsExecution(
	keyValues: any,
	stateMachineArn: string
) {
	const startExecutionCommand = new StartExecutionCommand({
		stateMachineArn: stateMachineArn,
		input: JSON.stringify(keyValues) // The data that will be passed to the state machine as input
	});

	try {
		const sfnResponse = await sfnClient.send(startExecutionCommand);
		console.log('Step Functions response:', sfnResponse);
	} catch (err) {
		console.error('Step Functions execution failed:', err);
		throw err;
	}
	console.log('Step Functions execution started!');
}
