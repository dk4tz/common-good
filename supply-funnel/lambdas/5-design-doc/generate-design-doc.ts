import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

interface StepFunctionEvent {
	[key: string]: any;
}

// AWS clients initialization
const sesClient = new SESClient({ region: process.env.REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

export const handler = async (event: StepFunctionEvent): Promise<void> => {
	// Log the event
	console.log('Look here vvvvv');
	console.log(JSON.stringify({ event }));

	// Extract the task token and admin email from the event and environment variable
	const adminEmail = process.env.ADMIN_EMAIL;

	// To Do: generate entry in DynamoDB table. project data + status = pending

	// Check if adminEmail environment variable is set
	if (!adminEmail) {
		console.error(`Required environment variable is missing: ADMIN_EMAIL`);
		throw new Error('Environment variable ADMIN_EMAIL not set correctly.');
	}

	console.log('hello dad');
	console.log(adminEmail);
};

// Fetch parameters from AWS SSM
async function getParam(param: string): Promise<string> {
	const response = await ssmClient.send(
		new GetParameterCommand({ Name: param })
	);
	if (!response.Parameter?.Value) {
		throw new Error(`Failed to get ${param} from SSM`);
	}
	return response.Parameter.Value;
}
