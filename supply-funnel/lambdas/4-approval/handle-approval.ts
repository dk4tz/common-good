import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SendTaskSuccessCommand, SFNClient } from '@aws-sdk/client-sfn';

export const handler = async (
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
	console.log('Handling incoming event', JSON.stringify(event));

	const taskToken = event.queryStringParameters?.taskToken;
	if (!taskToken) {
		return {
			statusCode: 400,
			body: 'Task Token is required'
		};
	}

	const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

	const sendTaskSuccessCommand = new SendTaskSuccessCommand({
		taskToken: taskToken,
		output: JSON.stringify({
			decision: 'approve'
		})
	});

	try {
		await sfnClient.send(sendTaskSuccessCommand);
		console.log('Project approved!');

		return {
			statusCode: 200,
			body: JSON.stringify({
				message: 'You successfully approved the project.'
			})
		};
	} catch (error) {
		console.error(error);

		return {
			statusCode: 500,
			body: JSON.stringify({
				message:
					"There was an error approving the project. It's likely we've already processed this project. If by mistake, generate a duplicate entry in Monday.com and try again."
			})
		};
	}
	// To Do: Update DynamoDB status = approved, generate GPT answers to Design Doc questions, send email to project owner
};
