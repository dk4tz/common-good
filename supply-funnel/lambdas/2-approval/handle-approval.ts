import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const dbClient = new DynamoDBClient({ region: 'us-west-2' }); // replace with your region
const sesClient = new SESClient({ region: 'us-west-2' }); // replace with your region

export const handler = async (event: any) => {
	// No need for 'Context' as the input is now state machine input
	const projectData = JSON.parse(event.input); // Use event.input to get state machine input

	try {
		// Add the project data to the database
		// Modify this section to suit your DynamoDB table structure
		const putCommand = new PutItemCommand({
			TableName: 'Projects',
			Item: {
				// Here's a basic structure for DynamoDB items. Modify it to match your project data
				ID: { S: projectData.id },
				CustomerEmail: { S: projectData.customerEmail },
				ProjectDetails: { S: JSON.stringify(projectData) }
			}
		});
		await dbClient.send(putCommand);

		// Send approval email to the customer
		const sendEmailCommand = new SendEmailCommand({
			Destination: {
				ToAddresses: [
					projectData.customerEmail // The email address of the customer
				]
			},
			Message: {
				Body: {
					Text: {
						Data: 'Your project has been approved!',
						Charset: 'UTF-8'
					}
				},
				Subject: {
					Data: 'Project Approval',
					Charset: 'UTF-8'
				}
			},
			Source: 'noreply@yourdomain.com' // Replace with your "From" address
		});
		await sesClient.send(sendEmailCommand);

		console.log(`Approval email sent to ${projectData.customerEmail}`);
		return { statusCode: 200, body: 'Project approved and email sent.' };
	} catch (err) {
		console.log(err);
		return { statusCode: 500, body: 'An error occurred.' };
	}
};
