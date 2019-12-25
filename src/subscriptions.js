// every service should define a single file that exports Array<Subscription>
// which defines how it interacts with each queue and any filters or options

const { Filing } = require('@postilion/models');

const FilingManager = require('./managers/filing-manager');
const filingManager = new FilingManager();

module.exports = [
	{
		name: 'ParseCrawledFiling',
		model: Filing,
		operation: 'update',
		handler: filingManager.parseCrawledFiling,
		filters: [
			{
				status: 'crawled'
			}
		],
		options: {},
	}
];