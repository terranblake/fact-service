const { Job } = require('@postilion/event-framework');
const { FilingDocument } = require('@postilion/models');

class FilingManager {
	constructor() {}

	// lookup all filing documents and parse facts
	// from each as necessary
	async parseCrawledFiling (job) {
		// get filing id from job
		const filing = job.data._id;

		// get all filing documents
		const documents = await FilingDocument.find({ filing });

		// parse all documents
		// create all facts
		// update filing to parsed
	}
}

module.exports = FilingManager;