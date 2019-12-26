// every service should define a single file that exports Array<Subscription>
// which defines how it interacts with each queue and any filters or options

const models = require('@postilion/models');
const { Operation } = require('@postilion/event-framework');

const FilingManager = require('./managers/filing-manager');
const filingManager = new FilingManager();

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
					"fullDocument.status": 'seeded'
				}
			}
		],
		options: {},
	}
];