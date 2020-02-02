const { Fact } = require('@postilion/models');
const { logger } = require('@postilion/utils');

const rawReportsTemplates = require('fs').readFileSync(`${process.cwd()}/src/data/reports.json`);
const statements = JSON.parse(rawReportsTemplates);

class StatementManager {
	constructor() { }

	// lookup all filing documents and parse facts
	// from each as necessary
	async getStatementsFromFiling(job) {
		const { _id, company } = job.data;

		const filingFactCount = await Fact.countDocuments({ filing: _id });
		if (!filingFactCount) {
			logger.info(`no facts found for filing ${_id} company ${company}`);
			return;
		}

		let formattedStatements = {}
		// fixme: iterate through all statements
		for (const statement of ['income']) {
			formattedStatements[statement] = {};
			const { lineitems: lineItems, totals } = statements[statement];

			lineItems.forEach(i => {
				formattedStatements[statement][i] = [];
			});

			logger.info(`getting statement ${statement} for filing ${_id} company ${company}`);
			const statementFacts = JSON.parse(require('fs').readFileSync(`${process.cwd()}/src/data/${statement}.json`));

			for (let fact of Object.keys(statementFacts)) {
				const templateCandidates = await Fact.find({ filing: _id, name: fact }).lean();

				if (!templateCandidates || !templateCandidates.length) {
					continue;
				}

				logger.info(`found ${templateCandidates.length} facts for identifier ${fact} filing ${_id} company ${company}`);
				if (templateCandidates.length > 1) {
					logger.warn(`multiple facts returned for identifier. using first returned ${fact} filing ${_id} company ${company}`);
				}

				// fixme: do something more intelligient here
				const selectedCandidate = templateCandidates[0];

				formattedStatements[statement] = this.handleStatementAddititons(
					statementFacts[fact]['add-to'],
					formattedStatements[statement],
					lineItems,
					selectedCandidate.name
				);

				formattedStatements[statement] = this.handleLineItemTotal(
					statementFacts[fact].total,
					formattedStatements[statement],
					selectedCandidate.name
				);
			}

			formattedStatements[statement].totals = this.handleStatementTotals(
				formattedStatements[statement],
				totals
			);

			logger.info(JSON.stringify(formattedStatements[statement]));
		}
	}

	handleStatementAddititons(additions, statement, lineItems, candidateName) {
		if (!additions) {
			return statement;
		}

		for (const item of additions) {
			if (!lineItems.includes(item)) {
				logger.warn(`line items for statement ${statement} don\'t include the name ${item} filing ${_id} company ${company}`);
				continue;
			}
			
			statement[item].push(candidateName);
		}

		return statement;
	}

	handleLineItemTotal(total, statement, candidateName) {
		if (!total || statement[total].length) {
			return statement;
		}

		statement[total] = [candidateName];
		return statement;
	}

	handleStatementTotals(statement, totals) {
		if (!Object.keys(totals).length) {
			return {};
		}

		let statementTotals = {};
		for (let total in totals) {
			statementTotals[total] = totals[total].reduce((acc, curr) => {				
				if (Object.keys(totals).includes(curr)) {
					// todo: handle duplicates using sets
					// todo: handle deeply recursive situations
					// tood: CLEAN THIS SHIT UP
					for (let item of totals[curr]) {
						for (let sub of statement[item]) {
							if (!acc.includes(sub)) {
								acc.push(sub);
							}
						}
					}
				} else if (statement[curr].length) {
					for (let sub of statement[curr]) {
						if (!acc.includes(sub)) {
							acc.push(sub);
						}
					}
				}

				return acc;
			}, []);
		}

		return statementTotals;
	}
}

module.exports = StatementManager;