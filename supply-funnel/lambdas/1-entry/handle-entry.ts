// AWS SDK imports
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StartExecutionCommand, SFNClient } from '@aws-sdk/client-sfn';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

// Import Node.js crypto module to create deterministic UUIDs
import * as crypto from 'crypto';

// Monday.com form field lookup
const MONDAY_FORM_FIELD_LOOKUP: Record<string, any> = {
	date4: 'form-start-date',
	text7: 'contact-name',
	short_text04: 'contact-role',
	email4: 'contact-email',
	text3: 'project-name',
	country: 'project-country',
	true___false56: 'monitoring-and-evaluation',
	status1: 'toc-design',
	upload_file67: 'toc-document-upload',
	long_text23: 'toc-key-activities-and-outcomes',
	status4: 'intended-unintended-outcomes',
	long_text00: 'intended-unintended-outcomes-justification',
	single_select1: 'beneficiaries-household-data',
	long_text874: 'beneficiaries-household-data-justification',
	upload_file0: 'beneficiaries-household-data-document-upload',
	single_select9: 'baseline and endline assessments',
	long_text67: 'baseline and endline assessments-justification',
	upload_file06: 'baseline and endline assessments-document-upload',
	single_select54: 'periodic-reporting',
	long_text02: 'periodic-reporting-justification',
	long_text45: 'periodic-reporting-justification',
	upload_file: 'periodic-reporting',
	single_select6: 'beneficiary-surveys',
	long_text99: 'beneficiary-surveys-justification',
	upload_file2: 'beneficiary-surveys-document-upload',
	single_select11: 'external-contributions',
	long_text672: 'external-contributions-justification',
	single_select96: 'partner-contributions',
	long_text780: 'partner-contributions-justification',
	single_select60: 'beneficiaries-consent',
	long_text86: 'beneficiaries-consent-justification',
	true___false: 'impact-profile',
	short_text: 'selected-outcome',
	single_select: 'selected-outcome-scale',
	single_select51: 'selected-outcome-duration',
	long_text35: 'selected-outcome-justification',
	upload_file4: 'selected-outcome-document-upload',
	single_select7: 'counterfactual',
	long_text20: 'counterfactual-justification',
	long_text87: 'counterfactual-methodology',
	upload_file3: 'counterfactual-document-upload',
	single_select2: 'outcome-impact-theme',
	long_text_3: 'outcome-impact-theme',
	short_text8: 'outcome-impact-theme',
	number1: 'minutes-to-complete-assessment',
	true___false6: 'anonymized-data',
	long_text0: 'additional-comments'
};

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Main lambda handler
export const handler = async (
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
	console.log('Handling incoming event', JSON.stringify(event));

	if (!event.body) {
		console.error('Error: No event body');
		throw new Error('No event body');
	}

	const input = JSON.parse(event.body);
	const config = await init();

	if ('challenge' in input) {
		console.log('Handling challenge event');
		return handleChallengeEvent(input);
	}

	if (input.event.type === 'create_pulse') {
		console.log('Handling create_pulse event');
		return await handleCreatePulseEvent(input, config);
	}

	console.warn('Warning: Event not handled');
	return {
		statusCode: 400,
		body: JSON.stringify({ message: 'Event not handled' })
	};
};

async function init() {
	console.log('Initializing and fetching necessary parameters');
	const [stateMachineArn, impactTableName, bucketName] = await Promise.all([
		getParam('/supply-funnel/state-machine-arn'),
		getParam('/supply-funnel/impact-table-name'),
		getParam('/supply-funnel/s3-bucket-name')
	]);
	return { stateMachineArn, impactTableName, bucketName };
}

async function getParam(param: string): Promise<string> {
	console.log(`Fetching parameter ${param} from SSM`);
	const response = await ssmClient.send(
		new GetParameterCommand({ Name: param })
	);
	if (!response.Parameter?.Value) {
		console.error(`Error: Failed to get ${param} from SSM`);
		throw new Error(`Failed to get ${param} from SSM`);
	}
	return response.Parameter.Value;
}

async function handleChallengeEvent(
	input: any
): Promise<APIGatewayProxyResult> {
	return {
		statusCode: 200,
		body: JSON.stringify({ challenge: input.challenge })
	};
}

async function handleCreatePulseEvent(input: any, config: any) {
	const keyValues = transformData(input.event.columnValues);
	console.log('Transformed data:', JSON.stringify(keyValues));

	const stepFunctionPayload = {
		orgName: input.event.pulseName.replace(/[^a-zA-Z0-9()]/g, '_'),
		projectData: keyValues,
		bucketName: config.bucketName
	};

	await Promise.all([
		saveToDynamoDB(keyValues, config.impactTableName),
		startStepFunctionsExecution(stepFunctionPayload, config.stateMachineArn)
	]);

	return {
		statusCode: 200,
		body: JSON.stringify({ message: 'Event handled successfully' })
	};
}

async function startStepFunctionsExecution(
	payload: any,
	stateMachineArn: string
) {
	console.log('Starting StepFunctions execution');
	await sfnClient.send(
		new StartExecutionCommand({
			stateMachineArn: stateMachineArn,
			input: JSON.stringify(payload)
		})
	);
}

const findNestedValue = (obj: Record<string, any>, keys: string[]): any => {
	if (!obj || typeof obj !== 'object') return;

	for (let key of keys) {
		if (obj[key] !== undefined) return obj[key];
	}

	for (let subKey in obj) {
		if (obj[subKey] !== null) {
			let found = findNestedValue(obj[subKey], keys);
			if (found !== undefined) return found;
		}
	}
};

const transformData = (
	projectData: Record<string, any>
): { [key: string]: any } => {
	let result: { [key: string]: any } = {};

	for (let key in projectData) {
		const newKey = MONDAY_FORM_FIELD_LOOKUP[key] || key;

		result[newKey] =
			findNestedValue(projectData[key], [
				'value',
				'text',
				'date',
				'countryName',
				'checked'
			]) || 'empty';
	}

	return result;
};

function generateIdFromContent(content: any): string {
	const str = JSON.stringify(content);
	const hash = crypto.createHash('sha256').update(str, 'utf8').digest('hex');
	return hash;
}

async function saveToDynamoDB(
	keyValues: Record<string, any>,
	tableName: string
) {
	console.log(`Saving data to DynamoDB table ${tableName}`);

	// We'll build a single item to insert.
	let item: any = {
		id: { S: generateIdFromContent(keyValues) } // A new unique ID for the record.
	};

	for (const [key, value] of Object.entries(keyValues)) {
		if (typeof key !== 'string') {
			console.error(`Invalid key: ${key}`);
			continue;
		}

		if (typeof value === 'string') {
			item[key] = { S: value };
		} else if (typeof value === 'number') {
			item[key] = { N: value.toString() };
		} else if (typeof value === 'boolean') {
			item[key] = { BOOL: value };
		} else {
			console.error(
				`Unhandled type for value associated with key, val: ${key}, ${value}`
			);
			continue;
		}
	}

	await dynamoClient.send(
		new PutItemCommand({
			TableName: tableName,
			Item: item
		})
	);
}
