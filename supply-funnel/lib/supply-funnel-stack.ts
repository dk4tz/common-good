import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import { StateMachine, StateMachineType } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface SupplyFunnelStackProps extends StackProps {
	environmentName: string;
}

export class SupplyFunnelStack extends Stack {
	constructor(scope: Construct, id: string, props: SupplyFunnelStackProps) {
		super(scope, id, props);

		const { environmentName } = props;

		// AWS Step Function for event handling
		const handleEventFunction = new Function(this, 'HandleEventFunction', {
			code: Code.fromInline(`
        exports.handler = async function(event) {
          console.log('Event received: ', event);
        };
      `),
			runtime: Runtime.NODEJS_18_X,
			handler: 'index.handler',
			timeout: Duration.seconds(30)
		});

		const handleEventStateMachine = new StateMachine(
			this,
			'HandleEventStateMachine',
			{
				stateMachineName: `handleEventStateMachine-${environmentName}`,
				definition: new LambdaInvoke(this, 'HandleEvent', {
					lambdaFunction: handleEventFunction
				}),
				stateMachineType: StateMachineType.EXPRESS
			}
		);

		// AWS Lambda Function for webhook validation
		const webhookHandlerLambda = new Function(
			this,
			'WebhookHandlerLambda',
			{
				code: Code.fromInline(`
        exports.handler = async function(event) {
          if (event.body && event.body.challenge) {
            return {
              statusCode: 200,
              body: JSON.stringify({ challenge: event.body.challenge }),
            };
          }

          const AWS = require('aws-sdk');
          const stepFunctions = new AWS.StepFunctions();
          await stepFunctions.startExecution({
            stateMachineArn: '${handleEventStateMachine.stateMachineArn}',
            input: JSON.stringify(event.body),
          }).promise();

          return { statusCode: 200 };
        };
      `),
				runtime: Runtime.NODEJS_18_X,
				handler: 'index.handler',
				environment: {
					AWS_SDK_VERSION: '3'
				},
				timeout: Duration.seconds(30)
			}
		);

		// Grant Start Execution Permission to the Lambda Function
		handleEventStateMachine.grantStartExecution(webhookHandlerLambda);

		// AWS API Gateway HTTP API configuration
		const httpApi = new HttpApi(this, 'HttpApi', {
			apiName: `supplyFunnelApi-${environmentName}`,
			defaultIntegration: new LambdaProxyIntegration({
				handler: webhookHandlerLambda
			})
		});

		httpApi.addRoutes({
			path: '/',
			methods: [HttpMethod.POST],
			integration: new LambdaProxyIntegration({
				handler: webhookHandlerLambda
			})
		});
	}
}
