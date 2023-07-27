// AWS CDK Libraries
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { join } from 'path';

// Stack Properties Interface
export interface SupplyFunnelStackProps extends cdk.StackProps {
	environmentName: string;
	adminEmail: string;
}

// Main Stack Class
export class SupplyFunnelStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: SupplyFunnelStackProps) {
		super(scope, id, props);

		const { environmentName, adminEmail } = props;

		// Define Role for Lambda Execution
		const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
			assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
		});
		lambdaRole.addManagedPolicy(
			iam.ManagedPolicy.fromAwsManagedPolicyName(
				'service-role/AWSLambdaBasicExecutionRole'
			)
		);

		// Create S3 bucket to store entries
		const s3Bucket = new s3.Bucket(this, 'SupplyFunnelBucket', {
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			versioned: true
		});

		// Give lambda functions permissions to use the bucket
		lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['s3:PutObject'],
				resources: [s3Bucket.arnForObjects('*')]
			})
		);

		// Define Lambda Functions for various tasks
		const handleEntryLambda = this.createLambdaFunction(
			'1-entry/handle-entry.ts',
			'HandleEntryLambda',
			lambdaRole,
			{ BUCKET_NAME: s3Bucket.bucketName }
		);
		const handleApprovalLambda = this.createLambdaFunction(
			'2-approval/handle-approval.ts',
			'HandleApprovalLambda',
			lambdaRole
		);
		const handleWaitlistLambda = this.createLambdaFunction(
			'3-waitlist/handle-waitlist.ts',
			'HandleWaitlistLambda',
			lambdaRole
		);
		const adminChoiceLambda = this.createLambdaFunction(
			'4-admin/admin-choice.ts',
			'AdminChoiceLambda',
			lambdaRole
		);

		// Create SNS Topic for Admin Notifications
		const adminNotificationTopic = new sns.Topic(
			this,
			'AdminNotificationTopic'
		);
		adminNotificationTopic.addSubscription(
			new subs.EmailSubscription(adminEmail)
		);

		// Define API Gateway and add methods to it
		const api = new apigateway.RestApi(this, 'HttpApi', {
			restApiName: `supplyFunnelApi-${environmentName}`
		});
		api.root.addMethod(
			'POST',
			new apigateway.LambdaIntegration(handleEntryLambda)
		); // For handling entries
		api.root
			.addResource('admin-decision')
			.addMethod(
				'POST',
				new apigateway.LambdaIntegration(adminChoiceLambda)
			); // For handling admin decision

		// Define Step Function States
		const approvalState = this.createStepFunctionState(
			'HandleApprovalState',
			handleApprovalLambda
		);
		const waitlistState = this.createStepFunctionState(
			'HandleWaitlistState',
			handleWaitlistLambda
		);

		// Define State Machine for decision making
		new sfn.StateMachine(this, 'DecisionStateMachine', {
			definition: new sfn.Choice(this, 'Admin Decision')
				.when(
					sfn.Condition.stringEquals('$.decision', 'approve'),
					approvalState
				)
				.when(
					sfn.Condition.stringEquals('$.decision', 'waitlist'),
					waitlistState
				),
			timeout: cdk.Duration.minutes(5)
		});
	}

	// Helper Function to create Lambda Functions
	createLambdaFunction(
		filePath: string,
		id: string,
		lambdaRole: iam.Role,
		environment?: { [key: string]: string }
	) {
		return new lambdaNodeJs.NodejsFunction(this, id, {
			role: lambdaRole,
			entry: join(__dirname, `../lambdas/${filePath}`),
			handler: 'handler',
			environment
		});
	}

	// Helper Function to create Step Function States
	createStepFunctionState(
		id: string,
		lambdaFunc: lambdaNodeJs.NodejsFunction
	) {
		return new sfnTasks.LambdaInvoke(this, id, {
			lambdaFunction: lambdaFunc,
			outputPath: '$.Payload'
		});
	}
}
