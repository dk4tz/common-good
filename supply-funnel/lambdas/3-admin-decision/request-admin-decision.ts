// DateTime dependencies for exipry
import { DateTime } from 'luxon';
// AWS SDK and dependencies
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// AWS clients initialization
const sesClient = new SESClient({ region: process.env.REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.REGION });

interface StepFunctionEvent {
	[key: string]: any;
}

export const handler = async (event: StepFunctionEvent): Promise<void> => {
	// Fetch the API Gateway URL
	const apiGatewayUrl = await getParam('/supply-funnel/api-gateway-url');
	const adminEmail = process.env.ADMIN_EMAIL;
	const impactBucketName = process.env.IMPACT_BUCKET_NAME;

	// Log the event;
	console.log('Handling incoming event', JSON.stringify(event));

	// Extract the task token, project name from the event
	const { orgName, projectName, taskToken } = event;

	// Check if adminEmail environment variable is set
	if (!adminEmail || !impactBucketName) {
		console.error(
			'Check that ADMIN_EMAIL and IMPACT_BUCKET_NAME are set correctly.'
		);
		throw new Error(
			`Required environment variable is missing: ADMIN_EMAIL or IMPACT_BUCKET_NAME`
		);
	}

	// Send email with approval link
	await sendApprovalEmail(
		taskToken,
		orgName,
		projectName,
		adminEmail,
		impactBucketName,
		apiGatewayUrl
	);
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
	orgName: string,
	projectName: string,
	adminEmail: string,
	impactBucketName: string,
	apiGatewayUrl: string
) {
	// Construct object keys
	const rawCsvKey = `${orgName}/${projectName}_rawImpactAssessment.csv`;
	console.log('rawCsvKey: ', rawCsvKey);
	const reportPdfKey = `${orgName}/${projectName}_impactAssessmentReport.pdf`;

	// Generate pre-signed URL for raw CSV
	const rawCsvCommand = new GetObjectCommand({
		Bucket: impactBucketName,
		Key: rawCsvKey
	});
	const rawCsvUrl = await getSignedUrl(s3Client, rawCsvCommand, {
		expiresIn: 604800
	});

	// Generate pre-signed URL for report PDF
	const reportPdfCommand = new GetObjectCommand({
		Bucket: impactBucketName,
		Key: reportPdfKey
	});
	const reportPdfUrl = await getSignedUrl(s3Client, reportPdfCommand, {
		expiresIn: 604800
	});

	// Communicate S3 download link expiration date/time
	const expirationDateTime = DateTime.now()
		.setZone('America/New_York')
		.plus({ days: 7 })
		.toFormat('MMMM dd, yyyy t');

	// Email subject
	const subject = `Admin Decision Requested - ${projectName}`;

	// Email body text
	let bodyText = `
		<h2>Project Details</h2>
		<h4>Organization Name: ${orgName}</h4>
		<p>Link to Raw Impact Assessment: <a href="${rawCsvUrl}">${projectName}_rawImpactAssessment.csv</a></p>
		<p>Link to Impact Assessment Report: <a href="${reportPdfUrl}">${projectName}_impactAssessmentReport.pdf</a></p>
		<p>Note: These download links expire on <strong>${expirationDateTime} EST</strong>.</p>
		<p>To take action, please click one of the following buttons:</p>
		<p><a href="${apiGatewayUrl}approve?taskToken=${encodeURIComponent(
		taskToken
	)}">Approve</a></p>
		<p><a href="${apiGatewayUrl}waitlist?taskToken=${encodeURIComponent(
		taskToken
	)}">Waitlist</a></p>
		`;

	const params = {
		Destination: {
			ToAddresses: [adminEmail]
		},
		Message: {
			Body: {
				Html: { Data: bodyText }
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
