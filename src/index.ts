
import {config} from "dotenv";
import { connect } from "http2";
config();

import * as mysql from "mysql";
import fetch from "node-fetch";

const chunk: any = (arr, chunkSize) => {
    var R = [];
    for (var i = 0; i < arr.length; i += chunkSize)
        R.push(arr.slice(i, i + chunkSize));
    return R;
}

const connection = mysql.createConnection({
    host: process.env.mysql_host,
    user: process.env.mysql_user,
    password: process.env.mysql_password,
    database: process.env.mysql_database,
    multipleStatements: true
});
connection.connect();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    var microbuddyId = 1;
    var seen = [];

    var waitForSelect = 2;
    connection.query("SELECT * FROM `traits`", (error, results, fields) => {
        if (error) throw error;
        for (var i = 0; i < results.length; i++) {
            const traitData = results[i];
            var trait: any = [];
            trait.push(traitData.mutation);
            trait.push(traitData.rarity);
            trait.push(traitData.type);
            trait.push(traitData.value);
            trait.push(traitData.name);
            trait.push(traitData.buddytype);
            seen.push(JSON.stringify(traitData));
        }
        waitForSelect -= 1;
    });
    connection.query("SELECT * FROM `microbuddies` ORDER BY `tokenId` DESC LIMIT 1", (error, results, fields) => {
        if (error) throw error;
        microbuddyId = results[0].tokenId + 1;
        waitForSelect -= 1;
    });

    while (waitForSelect !== 0) { await delay(1000); };

    var microbuddies = [];
    var traits = [];
    while(true) {
        const response = await fetch('https://api.microbuddies.io/' + microbuddyId.toString() + '.json');
        var data;
        var microbuddy: any = {};

        try {
            data = await response.json();
        } catch (err) {
            console.log(err);
            microbuddyId += 1;
            const response = await fetch('https://api.microbuddies.io/' + microbuddyId.toString() + '.json');
            try {
                data = await response.json();
            } catch (err) {
                console.log(err);
                break;
            }
        }

        microbuddy.tokenId = microbuddyId;
        microbuddy.quote = data.description.split('"')[1];
        microbuddy.name = data.name.split(' ')[0];
        microbuddy.species = data.name.split(' ').at(-1);
        microbuddy.generation = data.attributes[1].value;
        microbuddy.dominants = [];
        microbuddy.recessives = [];

        const microbuddyTraits =  data.dominants.concat(data.recessives);
        for (var i = 0; i < microbuddyTraits.length; i++) {
            const traitData = microbuddyTraits[i];
            var trait: any = [];
            if (traitData.mutation) trait.push(1);
            else trait.push(0);
            trait.push(traitData.rarity);
            trait.push(traitData.type);
            trait.push(traitData.value.split(' ')[0]);
            trait.push(traitData.value.split(' ')[1]);
            trait.push(microbuddy.species);
            if (i <= 5) microbuddy.dominants.push(trait);
            else microbuddy.recessives.push(trait);

            if (!seen.includes(JSON.stringify(traitData))) {
                seen.push(JSON.stringify(traitData));
                traits.push(trait);
            }
        }

        const microbuddyRaw = [
            microbuddy.tokenId,
            microbuddy.quote,
            microbuddy.name,
            microbuddy.species,
            microbuddy.generation,
            JSON.stringify(microbuddy.dominants),
            JSON.stringify(microbuddy.recessives)
        ];

        console.log("Got Microbuddy #"+microbuddyId.toString());
        microbuddies.push(microbuddyRaw);
        microbuddyId++;
    }
    console.log("Pushing traits to database");
    const traitChunks = chunk(traits, 100);
    for (var i = 0; i < traitChunks.length; i++) {
        connection.query("INSERT INTO traits (mutation, rarity, type, value, name, buddytype) VALUES ?", [traitChunks[i]], (error, results, fields) => {
            if (error) throw error;
        });
    }
    console.log("Pushing buddies to database");
    const microbuddyChunks = chunk(microbuddies, 100);
    for (var i = 0; i < microbuddyChunks.length; i++) {
        connection.query("INSERT INTO microbuddies (tokenId, quote, name, species, generation, dominants, recessives) VALUES ?", [microbuddyChunks[i]], (error, results, fields) => {
            if (error) throw error;
        });
    }
    connection.end();
})()

