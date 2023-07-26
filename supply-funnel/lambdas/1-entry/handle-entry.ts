import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const client = new S3Client({ region: 'us-east-1' }); // update the region if needed
const bucketName = process.env.BUCKET_NAME;

export const handler = async (
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
	console.log('Handle event triggered', event);

	if (!event.body) {
		throw new Error('No event body');
	}

	const input = JSON.parse(event.body);

	if ('challenge' in input) {
		console.log('Challenge event received!');
		return {
			statusCode: 200,
			body: JSON.stringify({
				challenge: input.challenge
			})
		};
	}

	if (input.event.type === 'create_pulse') {
		console.log('Create event received!');
		console.log(input);

		const projectName = input.event.pulseName;
		const projectData = input.event.columnValues;

		console.log('Project Name: ' + projectName);
		console.log('Project Data: ' + JSON.stringify(projectData));

		let keyValues: any = {};

		for (let key in projectData) {
			if (projectData[key].date) {
				keyValues[key] = projectData[key].date;
			} else if (projectData[key].text) {
				keyValues[key] = projectData[key].text;
			} else if (projectData[key].label && projectData[key].label.text) {
				keyValues[key] = projectData[key].label.text;
			} else if (projectData[key].value !== undefined) {
				// We check with undefined since the value might be a falsy value like 0 or ""
				keyValues[key] = projectData[key].value;
			}
		}

		console.log(keyValues);

		// Prepare data for CSV
		let csvRaw = 'Key,Value\n'; // CSV column headers
		for (let key in keyValues) {
			let value = keyValues[key].toString().replace(/"/g, '""'); // Convert to string and escape any double quotes in the value
			csvRaw += `"${key}","${value}"\n`; // Each line is a key-value pair enclosed in double quotes
		}

		console.log('Content of impactAssessmentRaw.csv:');
		console.log(csvRaw);

		const uploadRawImpactAssessment = new PutObjectCommand({
			Bucket: bucketName,
			Key: `${projectName}/impactAssessmentRaw.csv`,
			Body: csvRaw,
			ContentType: 'text/csv'
		});

		try {
			const s3Response = await client.send(uploadRawImpactAssessment);
			console.log(s3Response);
		} catch (err) {
			console.error(err);
		}
		console.log('Complete!');
	} else {
		console.log('Unknown event received!');
		return {
			statusCode: 400,
			body: JSON.stringify({
				message: 'Event not handled'
			})
		};
	}

	return {
		statusCode: 200,
		body: JSON.stringify({
			message: 'Event handled successfully'
		})
	};
};
