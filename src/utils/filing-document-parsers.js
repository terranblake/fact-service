const { Fact, Link } = require('@postilion/models');
const { logger } = require('@postilion/utils');

const {
    formatFacts,
    formatUnits,
    formatContexts,
    formatCalculationArcs,
    formatCalculationLocators
} = require('./filing-document-formatters');

module.exports = {
    instance: async (elements, filingId, company) => {
        elements = elements['xbrli:xbrl'] || elements.xbrl;

        let rawUnits = elements['xbrli:unit'] || elements.unit;;
        const formattedUnits = formatUnits(rawUnits);

        const rawContexts = elements['xbrli:context'] || elements.context;
        const formattedContexts = await formatContexts(rawContexts);

        const newFacts = await formatFacts(elements, formattedContexts, formattedUnits, filingId, company);
        logger.info(`found ${newFacts && newFacts.length} new facts from filing ${filingId} company ${company}`);
        for (let fact of newFacts) {
            await Fact.create(fact);
        }

        return newFacts;
    },
    calculation: async (elements, filing, company) => {
        elements = elements['link:linkbase'] || elements.linkbase;

        let formattedLinks = [];
        const calculationLinks = elements['link:calculationLink'] || elements.calculationLink;
        for (let link of calculationLinks) {
            const linkRole = link.$['xlink:role'];
            const name = linkRole.split('/').pop();

            // format calculation arcs
            const arcs = link['link:calculationArc'] || [];
            const formattedCalculationArcs = formatCalculationArcs(name, arcs);
            formattedLinks = formattedLinks.concat(formattedCalculationArcs);

            // format calculation locators
            const locators = link['link:loc'] || [];
            const formattedCalculationLocators = formatCalculationLocators(name, locators);
            formattedLinks = formattedLinks.concat(formattedCalculationLocators);
        }

        for (let link of formattedLinks) {
            await Link.create({ ...link, filing, company });
        }

        return formattedLinks;
    }
}