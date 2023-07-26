import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';

export interface SupplyFunnelStackProps extends cdk.StackProps {
	environmentName: string;
}

export class SupplyFunnelStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: SupplyFunnelStackProps) {
		super(scope, id, props);

		const { environmentName } = props;

		// Define IAM role for Lambda function
		const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
			assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
		});

		lambdaRole.addManagedPolicy(
			iam.ManagedPolicy.fromAwsManagedPolicyName(
				'service-role/AWSLambdaBasicExecutionRole'
			)
		);

		// Create S3 bucket
		const s3Bucket = new s3.Bucket(this, 'SupplyFunnelBucket', {
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			versioned: true
		});

		// Update IAM role to allow lambda to put objects in S3 bucket
		lambdaRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['s3:PutObject'],
				resources: [s3Bucket.arnForObjects('*')]
			})
		);

		const handleEntryLambda = new lambdaNodeJs.NodejsFunction(
			this,
			'HandleEntryLambda',
			{
				role: lambdaRole,
				entry: join(__dirname, '../lambdas/1-entry/handle-entry.ts'),
				handler: 'handler',
				environment: {
					BUCKET_NAME: s3Bucket.bucketName
				}
			}
		);

		// AWS API Gateway HTTP API configuration
		const api = new apigateway.RestApi(this, 'HttpApi', {
			restApiName: `supplyFunnelApi-${environmentName}`
		});

		const handleEntryLambdaIntegration = new apigateway.LambdaIntegration(
			handleEntryLambda
		);
		api.root.addMethod('POST', handleEntryLambdaIntegration);
	}
}
