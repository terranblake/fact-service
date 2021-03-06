// every service should define a single file that exports Array<Subscription>
// which defines how it interacts with each queue and any filters or options

const models = require('@postilion/models');
const { Operation } = require('@postilion/pubsub');

const FilingManager = require('./managers/filing-manager');
const filingManager = new FilingManager();

const StatementManager = require('./managers/statement-manager');
const statementManager = new StatementManager();

module.exports = [
	{
		name: 'ExtractFactsFromFiling',
		model: models.Filing,
		operation: Operation.update,
		handler: filingManager.getFactsFromFiling,
		filters: [
			{
				// if wanting to pull from an object store instead
				// of downloading from the sec, the status should
				// be set to downloaded before attempting this
				
				// the seeded status just means that we found everything
				// related to this model that needs to be found
				$match: {
					status: 'seeded'
				}
			}
		],
		options: {},
	},
	// {
	// 	name: 'ExtractStatementsFromFiling',
	// 	model: models.Filing,
	// 	operation: Operation.update,
	// 	handler: statementManager.getStatementsFromFiling,
	// 	filters: [
	// 		// {
	// 		// 	$match: {
	// 		// 		status: 'crawled'
	// 		// 	}
	// 		// }
	// 	],
	// 	options: {},
	// }
];