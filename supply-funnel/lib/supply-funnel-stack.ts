// AWS CDK Libraries
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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

		// === S3 Buckets ===
		const s3Bucket = new s3.Bucket(this, 'SupplyFunnelBucket', {
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			versioned: true
		});

		// === DynamoDB Tables ===
		const dynamoTable = new dynamodb.Table(this, 'ImpactAssessmentTable', {
			partitionKey: {
				name: 'id',
				type: dynamodb.AttributeType.STRING
			},
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});

		// === IAM Role & Permissions ===
		const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
			assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
		});
		// Lambda
		lambdaRole.addManagedPolicy(
			iam.ManagedPolicy.fromAwsManagedPolicyName(
				'service-role/AWSLambdaBasicExecutionRole'
			)
		);
		// S3
		lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['s3:PutObject'],
				resources: [s3Bucket.arnForObjects('*')]
			})
		);
		// Step Functions
		lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['states:StartExecution', 'states:SendTaskSuccess'],
				resources: ['*']
			})
		);
		// SES
		lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['ses:SendEmail', 'ses:SendRawEmail'],
				resources: ['*']
			})
		);
		// SSM Parameter Store
		lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['ssm:GetParameter'],
				resources: ['*']
			})
		);
		// DynamoDB
		lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					'dynamodb:GetItem',
					'dynamodb:PutItem',
					'dynamodb:UpdateItem',
					'dynamodb:Query',
					'dynamodb:Scan'
				],
				resources: [dynamoTable.tableArn]
			})
		);

		// === Lambdas ===
		const handleEntryLambda = this.createLambdaFunction(
			'1-entry/handle-entry.ts',
			'HandleEntryLambda',
			lambdaRole,
			10
		);
		const requestAdminDecisionLambda = this.createLambdaFunction(
			'2-admin-decision/request-admin-decision.ts',
			'RequestAdminDecisionLambda',
			lambdaRole,
			5,
			{ ADMIN_EMAIL: adminEmail }
		);
		const handleApprovalLambda = this.createLambdaFunction(
			'3-approval/handle-approval.ts',
			'HandleApprovalLambda',
			lambdaRole
		);
		const handleWaitlistLambda = this.createLambdaFunction(
			'4-waitlist/handle-waitlist.ts',
			'HandleWaitlistLambda',
			lambdaRole
		);

		// === Step Functions ===

		// State to invoke Lambda and request admin decision.
		const requestAdminDecisionState = new sfnTasks.LambdaInvoke(
			this,
			'RequestAdminDecisionState',
			{
				lambdaFunction: requestAdminDecisionLambda,
				integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
				payload: sfn.TaskInput.fromObject({
					taskToken: sfn.JsonPath.taskToken,
					'projectData.$': '$'
				})
			}
		);

		// State to invoke Lambda for approval handling.
		const approvalState = new sfnTasks.LambdaInvoke(this, 'ApprovalState', {
			lambdaFunction: handleApprovalLambda,
			outputPath: '$.Payload'
		});

		// State to invoke Lambda for waitlist handling.
		const waitlistState = new sfnTasks.LambdaInvoke(this, 'WaitlistState', {
			lambdaFunction: handleWaitlistLambda,
			outputPath: '$.Payload'
		});

		// Define the state machine.
		// 1. Starts with requesting the admin's decision.
		// 2. Based on the decision, it either moves to 'Approval' or 'Waitlist' state.
		const adminDecisionStateMachine = new sfn.StateMachine(
			this,
			'adminDecisionStateMachine',
			{
				definitionBody: sfn.DefinitionBody.fromChainable(
					sfn.Chain.start(requestAdminDecisionState).next(
						new sfn.Choice(this, 'Admin Decision')
							.when(
								sfn.Condition.stringEquals(
									'$.decision',
									'approve'
								),
								approvalState
							)
							.when(
								sfn.Condition.stringEquals(
									'$.decision',
									'waitlist'
								),
								waitlistState
							)
					)
				),
				timeout: cdk.Duration.minutes(5)
			}
		);

		// === API Gateway ===
		const api = new apigateway.RestApi(this, 'HttpApi', {
			restApiName: `supplyFunnelApi-${environmentName}`
		});
		// Add method for Monday.com webhook
		api.root.addMethod(
			'POST',
			new apigateway.LambdaIntegration(handleEntryLambda)
		);
		// Add resources and methods for each admin decision
		api.root
			.addResource('approve')
			.addMethod(
				'GET',
				new apigateway.LambdaIntegration(handleApprovalLambda)
			);
		api.root
			.addResource('waitlist')
			.addMethod(
				'GET',
				new apigateway.LambdaIntegration(handleWaitlistLambda)
			);

		// === SSM Parameters ===
		new ssm.StringParameter(this, 'S3BucketNameParameter', {
			parameterName: `/supply-funnel/s3-bucket-name`,
			stringValue: s3Bucket.bucketName
		});

		new ssm.StringParameter(this, 'DynamoTableNameParameter', {
			parameterName: `/supply-funnel/dynamo-table-name`,
			stringValue: dynamoTable.tableName
		});

		new ssm.StringParameter(this, 'StateMachineArnParameter', {
			parameterName: `/supply-funnel/state-machine-arn`,
			stringValue: adminDecisionStateMachine.stateMachineArn
		});

		new ssm.StringParameter(this, 'ApiGatewayUrlParameter', {
			parameterName: `/supply-funnel/api-gateway-url`,
			stringValue: api.url
		});
	}

	// Helper Function to create Lambda Functions
	createLambdaFunction(
		filePath: string,
		id: string,
		lambdaRole: iam.Role,
		timeoutSecs: number = 5,
		environment?: { [key: string]: string }
	) {
		return new lambdaNodeJs.NodejsFunction(this, id, {
			role: lambdaRole,
			entry: join(__dirname, `../lambdas/${filePath}`),
			handler: 'handler',
			timeout: cdk.Duration.seconds(timeoutSecs),
			environment
		});
	}
}
