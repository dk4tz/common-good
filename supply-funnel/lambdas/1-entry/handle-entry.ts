// AWS SDK imports
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
	status7: 'toc-strategic-integration',
	long_text42: 'toc-justification',
	status4: 'intended-unintended-outcomes',
	long_text00: 'intended-unintended-outcomes-justification',
	single_select1: 'beneficiaries-household-data',
	long_text874: 'beneficiaries-household-data-justification',
	upload_file0: 'beneficiaries-household-data-document-upload',
	single_select9: 'assessments',
	long_text67: 'assessments-justification',
	upload_file06: 'assessments-document-upload',
	single_select16: 'monitoring-activities',
	long_text78: 'monitoring-activities-justification',
	single_select5: 'framework-of-indicators',
	long_text200: 'framework-of-indicators-justification',
	single_select54: 'periodic-reporting',
	long_text45: 'periodic-reporting-justification',
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
	number: 'selected-outcome-scale',
	single_select51: 'selected-outcome-duration',
	long_text35: 'selected-outcome-justification',
	upload_file4: 'selected-outcome-document-upload',
	single_select10: 'degree-of-change',
	long_text04: 'degree-of-change-justification',
	single_select7: 'observed-results',
	long_text20: 'observed-results-justification',
	long_text87: 'observed-results-methodology',
	upload_file3: 'observed-results-document-upload',
	single_select2: 'observed-results-impact-theme',
	single_select12: 'observed-results-impact-theme-2',
	number5: 'observed-results-sdg-gain',
	number7: 'observed-results-additional-edu-years',
	single_select42: 'observed-results-associated-outcomes',
	short_text0: 'disability-treated',
	number0: 'morality-rate-percentage',
	number2: 'morality-rate-percentage-2',
	short_text8: 'outcome-impact-theme',
	number1: 'minutes-to-complete-assessment',
	true___false6: 'anonymized-data',
	long_text0: 'additional-comments'
};
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const sfnClient = new SFNClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
	console.log('Received event:', JSON.stringify(event));

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
	const [bucketName, stateMachineArn, dynamoTableName] = await Promise.all([
		getParam('/supply-funnel/s3-bucket-name'),
		getParam('/supply-funnel/state-machine-arn'),
		getParam('/supply-funnel/dynamo-table-name')
	]);
	return { bucketName, stateMachineArn, dynamoTableName };
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

	await Promise.all([
		uploadToS3(
			input.event.pulseName,
			prepareCsvData(keyValues),
			config.bucketName
		),
		saveToDynamoDB(keyValues, config.dynamoTableName),
		startStepFunctionsExecution(keyValues, config.stateMachineArn)
	]);
	return {
		statusCode: 200,
		body: JSON.stringify({ message: 'Event handled successfully' })
	};
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

function prepareCsvData(keyValues: any): string {
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
	projectName: string,
	csvRaw: string,
	bucketName: string
) {
	console.log(`Uploading to S3 bucket ${bucketName}`);
	await s3Client.send(
		new PutObjectCommand({
			Bucket: bucketName,
			Key: `${projectName}/impactAssessmentRaw.csv`,
			Body: csvRaw,
			ContentType: 'text/csv'
		})
	);
}

async function startStepFunctionsExecution(
	keyValues: any,
	stateMachineArn: string
) {
	console.log('Starting StepFunctions execution');
	await sfnClient.send(
		new StartExecutionCommand({
			stateMachineArn,
			input: JSON.stringify(keyValues)
		})
	);
}

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

// Pretty print a nested object
// type AnyDataStructure = { [key: string]: any } | any[];

// function customStringify(
// 	obj: AnyDataStructure,
// 	indent: string = '',
// 	visited: Set<any> = new Set()
// ): string {
// 	if (visited.has(obj)) {
// 		return '"[Circular]"';
// 	}
// 	visited.add(obj);

// 	if (Array.isArray(obj)) {
// 		const arrItems = obj.map((item) => {
// 			if (typeof item === 'object' && item !== null) {
// 				return customStringify(item, indent + '  ', visited);
// 			} else {
// 				return JSON.stringify(item);
// 			}
// 		});
// 		return '[\n' + indent + arrItems.join(',\n' + indent) + '\n]';
// 	} else if (typeof obj === 'object' && obj !== null) {
// 		const objItems = [];
// 		for (const key in obj) {
// 			if (obj.hasOwnProperty(key)) {
// 				const value = obj[key];
// 				objItems.push(
// 					JSON.stringify(key) +
// 						': ' +
// 						(typeof value === 'object' && value !== null
// 							? customStringify(value, indent + '  ', visited)
// 							: JSON.stringify(value))
// 				);
// 			}
// 		}
// 		return (
// 			'{\n' +
// 			indent +
// 			objItems.join(',\n' + indent) +
// 			'\n' +
// 			indent.substring(2) +
// 			'}'
// 		);
// 	} else {
// 		return JSON.stringify(obj);
// 	}
// }
