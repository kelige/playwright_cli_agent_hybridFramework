/**
 * DVS synthetic random data generators
 * @description Generates clearly synthetic test data only. These structures are
 * neutral test-data shapes and are not backend API request payloads.
 */

import { faker } from '@faker-js/faker';
import { DateTime } from 'luxon';

export class RandomDataUtil {
    // Person / test account data
    static getFirstName(): string {
        return faker.person.firstName();
    }

    static getLastName(): string {
        return faker.person.lastName();
    }

    static getFullName(): string {
        return faker.person.fullName();
    }

    static getEmail(): string {
        return faker.internet.email({ provider: 'dvs-automation.example.invalid' });
    }

    static getPhoneNumber(): string {
        return faker.phone.number();
    }

    static getDepartment(): string {
        return faker.commerce.department();
    }

    static getInstitutionName(): string {
        return faker.company.name();
    }

    static getExperienceYears(): number {
        return faker.number.int({ min: 0, max: 30 });
    }

    static getDailyCapacity(): number {
        return faker.number.int({ min: 1, max: 50 });
    }

    // Academic / examination data
    static getProgrammeCode(): string {
        return `DVS-AUTO-${faker.string.alpha({ length: 3, casing: 'upper' })}${faker.string.numeric(4)}`;
    }

    static getCourseCode(): string {
        return `DVS-AUTO-COURSE-${faker.string.numeric(4)}`;
    }

    static getSubjectCode(): string {
        return `DVS-AUTO-SUB-${faker.string.numeric(4)}`;
    }

    static getPaperCode(): string {
        return `DVS-AUTO-PAPER-${faker.string.numeric(4)}`;
    }

    static getAcademicYear(): string {
        const startYear = faker.number.int({ min: 2090, max: 2098 });
        return `${startYear}-${String(startYear + 1).slice(-2)}`;
    }

    static getExamSessionName(): string {
        return `DVS Automation Session ${faker.string.numeric(2)}`;
    }

    static getSubjectName(): string {
        return `Automation Test Subject ${faker.string.alpha({ length: 3, casing: 'upper' })}`;
    }

    static getPaperTitle(): string {
        return `Automation Test Paper ${faker.string.alpha({ length: 3, casing: 'upper' })}`;
    }

    // Date and time (ISO YYYY-MM-DD)
    static getCurrentDate(): string {
        return DateTime.now().toISODate()!;
    }

    static getRecentDate(days: number = 10): string {
        return DateTime.now().minus({ days }).toISODate()!;
    }

    static getFutureDate(years: number = 1): string {
        return DateTime.now().plus({ years }).toISODate()!;
    }

    static getPastDate(years: number = 1): string {
        return DateTime.now().minus({ years }).toISODate()!;
    }

    // Script and packet data
    static getScriptId(): string {
        return `DVS-AUTO-SCRIPT-${faker.string.numeric(6)}`;
    }

    static getPacketReference(): string {
        return `DVS-AUTO-PACKET-${faker.string.numeric(6)}`;
    }

    static getTestRunReference(): string {
        return `DVS-AUTO-RUN-${faker.string.numeric(6)}`;
    }

    static getPageCount(min: number = 1, max: number = 10): number {
        return faker.number.int({ min, max });
    }

    static getScriptsPerPacket(min: number = 1, max: number = 10): number {
        return faker.number.int({ min, max });
    }

    // DVS test data object generators
    static generateAdminUserData() {
        return {
            firstName: this.getFirstName(),
            lastName: this.getLastName(),
            email: this.getEmail(),
            role: 'Admin',
        };
    }

    static generateChairmanUserData() {
        return {
            firstName: this.getFirstName(),
            lastName: this.getLastName(),
            email: this.getEmail(),
            role: 'Chairman',
            programmeCode: this.getProgrammeCode(),
        };
    }

    static generateChiefProfileData() {
        return {
            fullName: this.getFullName(),
            email: this.getEmail(),
            department: this.getDepartment(),
            institution: this.getInstitutionName(),
            dailyCapacity: this.getDailyCapacity(),
            experienceYears: this.getExperienceYears(),
        };
    }

    static generateEvaluatorProfileData() {
        return {
            fullName: this.getFullName(),
            email: this.getEmail(),
            department: this.getDepartment(),
            institution: this.getInstitutionName(),
            dailyCapacity: this.getDailyCapacity(),
            experienceYears: this.getExperienceYears(),
        };
    }

    static generateAcademicConfigurationData() {
        const termSequence = faker.number.int({ min: 1, max: 8 });
        return {
            programmeCode: this.getProgrammeCode(),
            programmeName: `Automation Test Programme ${faker.string.alpha({ length: 3, casing: 'upper' })}`,
            regulationCode: `DVS-AUTO-REG-${faker.string.numeric(2)}`,
            regulationTitle: `Automation Test Regulation ${faker.string.alpha({ length: 3, casing: 'upper' })}`,
            academicYear: this.getAcademicYear(),
            termName: `Semester ${termSequence}`,
            termSequence,
            examSessionName: this.getExamSessionName(),
            courseCode: this.getCourseCode(),
            courseName: `Automation Test Course ${faker.string.alpha({ length: 3, casing: 'upper' })}`,
        };
    }

    static generateSubjectData() {
        return {
            subjectCode: this.getSubjectCode(),
            subjectName: this.getSubjectName(),
            courseCode: this.getCourseCode(),
            semester: faker.number.int({ min: 1, max: 8 }),
        };
    }

    static generatePaperData() {
        return {
            paperCode: this.getPaperCode(),
            paperTitle: this.getPaperTitle(),
            subjectCode: this.getSubjectCode(),
            maximumMarks: 100,
            passingMarks: 35,
            scriptsPerPacket: this.getScriptsPerPacket(),
            pagesPerScript: this.getPageCount(),
        };
    }

    static generateScriptMetadata() {
        return {
            scriptId: this.getScriptId(),
            paperCode: this.getPaperCode(),
            pageCount: this.getPageCount(),
            testRunReference: this.getTestRunReference(),
        };
    }

    static generatePacketMetadata() {
        const scriptIds: string[] = [];
        const scriptCount = this.getScriptsPerPacket();
        for (let index = 0; index < scriptCount; index++) {
            scriptIds.push(this.getScriptId());
        }

        return {
            packetReference: this.getPacketReference(),
            paperCode: this.getPaperCode(),
            scriptIds,
            testRunReference: this.getTestRunReference(),
        };
    }
}
