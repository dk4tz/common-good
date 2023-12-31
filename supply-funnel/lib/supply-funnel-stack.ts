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
		const s3Bucket = new s3.Bucket(this, 'ImpactAssessmentBucket', {
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			versioned: true
		});

		// === DynamoDB Tables ===
		const impactTable = new dynamodb.Table(this, 'ImpactAssessmentTable', {
			partitionKey: {
				name: 'id',
				type: dynamodb.AttributeType.STRING
			},
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			removalPolicy: cdk.RemovalPolicy.RETAIN
		});

		const designDocTable = new dynamodb.Table(this, 'DesignDocumentTable', {
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
				actions: ['s3:PutObject', 's3:GetObject'],
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
				resources: [impactTable.tableArn, designDocTable.tableArn]
			})
		);

		// === Lambdas ===
		const handleEntryLambda = this.createLambdaFunction(
			'1-entry/handle-entry.ts',
			'HandleEntryLambda',
			lambdaRole,
			{},
			10
		);
		const generateImpactAssessmentLambda = this.createLambdaFunction(
			'2-impact-assessment/generate-impact-assessment.ts',
			'GenerateImpactAssessmentLambda',
			lambdaRole,
			{ IMPACT_BUCKET_NAME: s3Bucket.bucketName }
		);
		const requestAdminDecisionLambda = this.createLambdaFunction(
			'3-admin-decision/request-admin-decision.ts',
			'RequestAdminDecisionLambda',
			lambdaRole,
			{ IMPACT_BUCKET_NAME: s3Bucket.bucketName, ADMIN_EMAIL: adminEmail }
		);
		const handleApprovalLambda = this.createLambdaFunction(
			'4-approval/handle-approval.ts',
			'HandleApprovalLambda',
			lambdaRole
		);
		const handleWaitlistLambda = this.createLambdaFunction(
			'5-waitlist/handle-waitlist.ts',
			'HandleWaitlistLambda',
			lambdaRole
		);
		const generateDesignDocLambda = this.createLambdaFunction(
			'6-design-doc/generate-design-doc.ts',
			'GenerateDesignDocLambda',
			lambdaRole,
			{ ADMIN_EMAIL: adminEmail }
		);

		// === Step Functions ===
		// Generate the Impact Assessment and save to S3
		const generateImpactAssessmentState = new sfnTasks.LambdaInvoke(
			this,
			'GenerateImpactAssessmentState',
			{
				lambdaFunction: generateImpactAssessmentLambda,
				integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
				outputPath: '$.Payload'
			}
		);

		// Request Admin Approve or Waitlist via email
		const requestAdminDecisionState = new sfnTasks.LambdaInvoke(
			this,
			'RequestAdminDecisionState',
			{
				lambdaFunction: requestAdminDecisionLambda,
				integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
				inputPath: '$.Payload',
				payload: sfn.TaskInput.fromObject({
					taskToken: sfn.JsonPath.taskToken,
					orgName: sfn.JsonPath.stringAt('$.orgName'),
					projectName: sfn.JsonPath.stringAt('$.projectName')
				}),
				taskTimeout: sfn.Timeout.duration(cdk.Duration.days(364)) // 1 year (max)
			}
		);

		// Approve Project
		const approvalState = new sfnTasks.LambdaInvoke(this, 'ApprovalState', {
			lambdaFunction: handleApprovalLambda,
			integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
			outputPath: '$'
		});

		// Waitlist Project
		const waitlistState = new sfnTasks.LambdaInvoke(this, 'WaitlistState', {
			lambdaFunction: handleWaitlistLambda,
			integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
			outputPath: '$'
		});

		// Generate Design Document Draft (GPT)
		const designDocState = new sfnTasks.LambdaInvoke(
			this,
			'DesignDocState',
			{
				lambdaFunction: generateDesignDocLambda,
				integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
				outputPath: '$'
			}
		);

		// Define the state machine
		const supplyFunnelStateMachine = new sfn.StateMachine(
			this,
			'supplyFunnelStateMachine',
			{
				definitionBody: sfn.DefinitionBody.fromChainable(
					sfn.Chain.start(generateImpactAssessmentState)
						.next(requestAdminDecisionState)
						.next(
							new sfn.Choice(this, 'Admin Decision')
								.when(
									sfn.Condition.stringEquals(
										'$.decision',
										'approve'
									),
									approvalState.next(designDocState)
								)
								.when(
									sfn.Condition.stringEquals(
										'$.decision',
										'waitlist'
									),
									waitlistState
								)
						)
				)
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

		new ssm.StringParameter(this, 'impactTableNameParameter', {
			parameterName: `/supply-funnel/impact-table-name`,
			stringValue: impactTable.tableName
		});

		new ssm.StringParameter(this, 'designDocTableNameParameter', {
			parameterName: `/supply-funnel/design-doc-table-name`,
			stringValue: impactTable.tableName
		});

		new ssm.StringParameter(this, 'StateMachineArnParameter', {
			parameterName: `/supply-funnel/state-machine-arn`,
			stringValue: supplyFunnelStateMachine.stateMachineArn
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
		environment?: { [key: string]: string },
		timeoutSecs: number = 5
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
