// AWS SDK and dependencies
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

// AWS clients initialization
const sesClient = new SESClient({ region: process.env.REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

interface StepFunctionEvent {
	[key: string]: any;
}

export const handler = async (event: StepFunctionEvent): Promise<void> => {
	// Fetch the API Gateway URL
	const apiGatewayUrl = await getParam('/supply-funnel/api-gateway-url');

	// Log the event
	console.log('Look here vvvvv');
	console.log(JSON.stringify({ event }));

	// Extract the task token and admin email from the event and environment variable
	const taskToken = event['taskToken'];
	const adminEmail = process.env.ADMIN_EMAIL;

	// Check if adminEmail environment variable is set
	if (!adminEmail) {
		console.error(`Required environment variable is missing: ADMIN_EMAIL`);
		throw new Error('Environment variable ADMIN_EMAIL not set correctly.');
	}

	// Send email with approval link
	await sendApprovalEmail(taskToken, adminEmail, apiGatewayUrl);
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

// Send email with approval link
async function sendApprovalEmail(
	taskToken: string,
	adminEmail: string,
	apiGatewayUrl: string
) {
	// Email subject and body text
	const subject = 'Admin Decision Required';
	const bodyText = `To take action, please click one of the following links: 
    Approve: <API_GATEWAY_URL>/approve?taskToken=<TASK_TOKEN> 
    Waitlist: <API_GATEWAY_URL>/waitlist?taskToken=<TASK_TOKEN>`;
	// Replace placeholder values in the body text
	const emailBody = bodyText
		.replace(/<API_GATEWAY_URL>/g, apiGatewayUrl)
		.replace(/<TASK_TOKEN>/g, encodeURIComponent(taskToken));

	const params = {
		Destination: {
			ToAddresses: [adminEmail]
		},
		Message: {
			Body: {
				Html: { Data: emailBody }
			},
			Subject: { Data: subject }
		},
		Source: adminEmail
	};

	try {
		// Send email using SES
		await sesClient.send(new SendEmailCommand(params));
		console.log('Email sent successfully');
	} catch (error) {
		console.error('Error while sending email:', error);
		throw error;
	}
}
