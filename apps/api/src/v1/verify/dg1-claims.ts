export { ageFromDateOfBirth } from "./dg1-dates";
export {
	type Dg1Claims,
	parseDg1Claims,
	parseTd3MrzClaims,
} from "./dg1-mrz";
export {
	MAX_FACE_MATCH_THRESHOLD,
	MIN_FACE_MATCH_THRESHOLD,
	resolveFaceMatchThreshold,
	resolveFaceMatchThresholdFromDg1,
} from "./dg1-threshold";
