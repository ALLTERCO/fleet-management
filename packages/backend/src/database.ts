import { Sequelize, DataTypes, Model } from 'sequelize';
import log4js from 'log4js';
const logger = log4js.getLogger("database");

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: 'database.sqlite',
    logging: false
});

export class Event extends Model {
    declare shellyID: string;
    declare method: string;
    declare msg: object;
    declare timestamp: number;
}

Event.init({
    shellyID: {
        type: DataTypes.STRING,
        allowNull: false
    },
    method: {
        type: DataTypes.STRING,
        allowNull: false
    },
    msg: {
        type: DataTypes.JSON,
        allowNull: false
    },
    timestamp: {
        type: DataTypes.NUMBER,
        allowNull: false
    }
}, { sequelize, timestamps: false });

export class History extends Model {
    declare shellyID: string;
    declare request: object;
    declare response: object;
    declare timestamp: number;
}

History.init({
    shellyID: {
        type: DataTypes.STRING,
        allowNull: false
    },
    request: {
        type: DataTypes.JSON,
        allowNull: false
    },
    response: {
        type: DataTypes.JSON,
        allowNull: false
    },
    timestamp: {
        type: DataTypes.NUMBER,
        allowNull: false
    }
}, { sequelize, timestamps: false });

export class Consumption extends Model {
    declare shellyID: string;
    declare channel: number;
    declare consumption: number;
    declare timestamp: number;
}

Consumption.init({
    shellyID: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channel: {
        type: DataTypes.NUMBER,
        allowNull: false
    },
    consumption: {
        type: DataTypes.REAL,
        allowNull: false
    },
    timestamp: {
        type: DataTypes.DECIMAL,
        allowNull: false
    }
}, { sequelize, timestamps: false });

sequelize.sync({ force: false });